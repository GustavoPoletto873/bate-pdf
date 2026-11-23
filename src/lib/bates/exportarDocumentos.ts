import { createHash } from 'node:crypto';
import { chaveDoPdf, lerArquivo } from '@/lib/arquivos';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { db } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';
import { ROTULO_LADO, type Lado } from '@/lib/campos';
import { formatarCpfCnpj } from '@/lib/texto';

/**
 * Resultados › Exportar documentos — porta de services/documentos_export_service.py do Bate
 * Lastro: ZIP com os documentos usados nos bates da base, para o dossiê da auditoria.
 *
 *   OPERACOES/<operação>/...   documentos enviados no Anexo (nome e pasta como vieram)
 *   DOCUMENTOS_LIDOS/...       PDFs enviados no Bater PDF, fora de uma operação do Anexo
 *   NOTAS_FISCAIS/<chave>.xml  XML de cada NF-e (NF Status)
 *   00_INDICE_AUDITORIA.xlsx   resumo, inventário de arquivos e vínculos título × documento
 *   SHA256SUMS.txt             hashes no formato do sha256sum (conferível com `sha256sum -c`)
 *
 * Arquivo ausente na pasta de dados não aborta: fica registrado como erro no índice.
 */

export type Escopo = 'vinculados' | 'todos';

const INVALIDOS = /[<>:"|?*\x00-\x1f]/g;
const segmento = (v: unknown, padrao = 'sem_nome') => String(v ?? '').replace(INVALIDOS, '_').replace(/[\\/]/g, '_').trim().replace(/^[ .]+|[ .]+$/g, '').slice(0, 120) || padrao;
/** Caminho relativo do usuário: mantém as pastas, sem `..`, raiz ou unidade. */
const caminhoSeguro = (v: unknown) => String(v ?? '').split(/[\\/]+/).filter((p) => p && p !== '.' && p !== '..' && !/^[A-Za-z]:$/.test(p)).map((p) => segmento(p)).join('/') || 'sem_nome';

type Item = { categoria: string; caminho: string; nome: string; operacao: string; tipo: string; leituras: number; confirmados: number; tamanho: number | null; sha256: string; situacao: string };

class NomesUnicos {
  private usados = new Set<string>();
  dar(caminho: string): string {
    let c = caminho;
    const ponto = caminho.lastIndexOf('.');
    for (let i = 2; this.usados.has(c.toLowerCase()); i++) c = ponto > caminho.lastIndexOf('/') ? `${caminho.slice(0, ponto)} (${i})${caminho.slice(ponto)}` : `${caminho} (${i})`;
    this.usados.add(c.toLowerCase());
    return c;
  }
}

export async function exportarDocumentos(baseId: string, escopo: Escopo = 'vinculados'): Promise<{ nome: string; zip: Uint8Array }> {
  const c = await db();
  const base = await c.prepare('SELECT id, nome, nome_fundo, cnpj_fundo, data_referencia FROM bases WHERE id = ?').get(baseId) as
    { id: string; nome: string; nome_fundo: string | null; cnpj_fundo: string | null; data_referencia: string | null } | undefined;
  if (!base) throw new ErroDeUso('Base não encontrada.', 404);

  // Vínculos de cada PDF (e por lado), para o índice e para o escopo "vinculados".
  const vinculos = await c.prepare(`SELECT v.pdf_id, v.pagina, v.tipo_match, v.criado_em, p.lado, t.numero_documento, t.sacado_nome, t.valor_total, t.id_base_origem, f.nome_arquivo
      FROM vinculos v JOIN pendencias p ON p.id = v.pendencia_id JOIN titulos t ON t.id = p.titulo_id LEFT JOIN pdfs f ON f.id = v.pdf_id
     WHERE p.base_id = ? ORDER BY t.id, p.lado`).all(baseId) as
    { pdf_id: number | null; pagina: number | null; tipo_match: string; criado_em: string; lado: Lado; numero_documento: string | null; sacado_nome: string | null; valor_total: string | null; id_base_origem: number | null; nome_arquivo: string | null }[];
  const confirmadosPorPdf = new Map<number, number>();
  for (const v of vinculos) if (v.pdf_id) confirmadosPorPdf.set(v.pdf_id, (confirmadosPorPdf.get(v.pdf_id) ?? 0) + 1);
  const leiturasPorPdf = new Map((await c.prepare('SELECT pdf_id, COUNT(*) n FROM leituras WHERE base_id = ? AND pdf_id IS NOT NULL GROUP BY pdf_id').all(baseId) as { pdf_id: number; n: number }[]).map((l) => [l.pdf_id, l.n]));

  const anexos = await c.prepare(`SELECT d.id, d.pdf_id, d.caminho, d.nome_arquivo, d.extensao, d.arquivo, d.tipo_documento, d.status, COALESCE(o.nome, o.chave) AS operacao
      FROM anexo_documentos d JOIN anexo_lotes l ON l.id = d.lote_id LEFT JOIN anexo_operacoes o ON o.id = d.operacao_id
     WHERE l.base_id = ? ORDER BY operacao, d.caminho`).all(baseId) as
    { id: number; pdf_id: number | null; caminho: string; nome_arquivo: string; extensao: string | null; arquivo: string | null; tipo_documento: string | null; status: string; operacao: string | null }[];
  const pdfs = await c.prepare('SELECT id, nome_arquivo, caminho_relativo, sha256, tamanho FROM pdfs WHERE base_id = ? ORDER BY nome_arquivo').all(baseId) as
    { id: number; nome_arquivo: string; caminho_relativo: string | null; sha256: string; tamanho: number }[];
  const pdfPorId = new Map(pdfs.map((p) => [p.id, p]));

  const zip = new JSZip();
  const nomes = new NomesUnicos();
  const itens: Item[] = [];
  const hashes: string[] = [];
  const incluidos = new Set<string>(); // sha256 já no ZIP (o mesmo PDF não entra duas vezes)

  const incluir = (categoria: string, caminho: string, bytes: Uint8Array | null, meta: Omit<Item, 'categoria' | 'caminho' | 'tamanho' | 'sha256' | 'situacao'>) => {
    if (!bytes) {
      itens.push({ categoria, caminho: '', ...meta, tamanho: null, sha256: '', situacao: 'Erro: arquivo não está mais na pasta de dados' });
      return;
    }
    const sha = createHash('sha256').update(bytes).digest('hex');
    if (incluidos.has(sha)) {
      itens.push({ categoria, caminho: '', ...meta, tamanho: bytes.length, sha256: sha, situacao: 'Idêntico a um arquivo já incluído (mesmo SHA-256)' });
      return;
    }
    incluidos.add(sha);
    const final = nomes.dar(caminho);
    zip.file(final, bytes, { compression: /\.(pdf|png|jpe?g|zip)$/i.test(final) ? 'STORE' : 'DEFLATE' });
    hashes.push(`${sha}  ${final}`);
    itens.push({ categoria, caminho: final, ...meta, tamanho: bytes.length, sha256: sha, situacao: 'Incluído' });
  };
  const lerPdf = (sha: string) => lerArquivo(chaveDoPdf(baseId, sha));

  const usadoNoAnexo = new Set<number>();
  for (const d of anexos) {
    const pdf = d.pdf_id ? pdfPorId.get(d.pdf_id) : null;
    if (escopo === 'vinculados' && !(d.pdf_id && confirmadosPorPdf.get(d.pdf_id))) continue;
    if (d.pdf_id) usadoNoAnexo.add(d.pdf_id);
    const bytes = pdf ? await lerPdf(pdf.sha256) : d.arquivo ? await lerArquivo(d.arquivo) : null;
    incluir('Anexo da operação (original)', `OPERACOES/${segmento(d.operacao ?? 'sem_operacao')}/${caminhoSeguro(d.caminho)}`, bytes, {
      nome: d.nome_arquivo, operacao: d.operacao ?? '', tipo: d.tipo_documento ?? '', leituras: d.pdf_id ? leiturasPorPdf.get(d.pdf_id) ?? 0 : 0, confirmados: d.pdf_id ? confirmadosPorPdf.get(d.pdf_id) ?? 0 : 0,
    });
  }
  for (const p of pdfs) {
    if (usadoNoAnexo.has(p.id)) continue;
    if (escopo === 'vinculados' && !confirmadosPorPdf.get(p.id)) continue;
    incluir('Documento lido no matching', `DOCUMENTOS_LIDOS/${caminhoSeguro(p.caminho_relativo || p.nome_arquivo)}`, await lerPdf(p.sha256), {
      nome: p.nome_arquivo, operacao: '', tipo: '', leituras: leiturasPorPdf.get(p.id) ?? 0, confirmados: confirmadosPorPdf.get(p.id) ?? 0,
    });
  }
  const notas = await c.prepare('SELECT chave_nfe, status_nfe, xml_content FROM notas_fiscais WHERE base_id = ? AND xml_content IS NOT NULL ORDER BY chave_nfe').all(baseId) as { chave_nfe: string; status_nfe: string; xml_content: string }[];
  for (const n of notas) {
    incluir('XML NF-e', `NOTAS_FISCAIS/${segmento(n.chave_nfe)}.xml`, new TextEncoder().encode(n.xml_content), { nome: `${n.chave_nfe}.xml`, operacao: '', tipo: `NF-e ${n.status_nfe}`, leituras: 0, confirmados: 0 });
  }
  if (!itens.length) {
    throw new ErroDeUso(escopo === 'vinculados'
      ? 'Nenhum documento vinculado nesta base ainda. Faça os bates ou exporte com "todos os documentos".'
      : 'Esta base não tem documentos enviados.', 404);
  }

  // Índice de auditoria.
  const livro = new ExcelJS.Workbook();
  const cab = (ws: ExcelJS.Worksheet) => { ws.getRow(1).font = { bold: true }; ws.views = [{ state: 'frozen', ySplit: 1 }]; };
  const resumo = livro.addWorksheet('Resumo');
  resumo.columns = [{ header: 'Item', key: 'k', width: 34 }, { header: 'Valor', key: 'v', width: 60 }];
  cab(resumo);
  for (const [k, v] of [
    ['Base', base.nome], ['Fundo', base.nome_fundo ?? ''], ['CNPJ do fundo', formatarCpfCnpj(base.cnpj_fundo)], ['Data de referência', base.data_referencia ?? ''],
    ['Escopo', escopo === 'vinculados' ? 'Documentos com bate confirmado' : 'Todos os documentos da base'],
    ['Gerado em', new Date().toLocaleString('pt-BR')], ['Arquivos incluídos', String(itens.filter((i) => i.situacao === 'Incluído').length)],
    ['Arquivos com erro', String(itens.filter((i) => i.situacao.startsWith('Erro')).length)], ['Vínculos título × documento', String(vinculos.length)],
  ]) resumo.addRow({ k, v });
  const arquivos = livro.addWorksheet('Arquivos');
  arquivos.columns = [
    { header: 'Categoria', key: 'categoria', width: 28 }, { header: 'Caminho no ZIP', key: 'caminho', width: 60 }, { header: 'Nome original', key: 'nome', width: 40 },
    { header: 'Operação', key: 'operacao', width: 24 }, { header: 'Tipo', key: 'tipo', width: 18 }, { header: 'Leituras', key: 'leituras', width: 10 },
    { header: 'Bates', key: 'confirmados', width: 8 }, { header: 'Tamanho (bytes)', key: 'tamanho', width: 14 }, { header: 'SHA-256', key: 'sha256', width: 66 }, { header: 'Situação', key: 'situacao', width: 40 },
  ];
  cab(arquivos);
  for (const i of itens) arquivos.addRow(i);
  const vinc = livro.addWorksheet('Vínculos');
  vinc.columns = [
    { header: 'ID_BASE', key: 'id', width: 10 }, { header: 'Nº documento', key: 'n', width: 18 }, { header: 'Sacado', key: 's', width: 32 }, { header: 'Valor', key: 'v', width: 14 },
    { header: 'Lado', key: 'l', width: 10 }, { header: 'Documento', key: 'd', width: 40 }, { header: 'Página', key: 'p', width: 8 }, { header: 'Bate', key: 't', width: 12 }, { header: 'Em', key: 'e', width: 20 },
  ];
  cab(vinc);
  for (const v of vinculos) {
    vinc.addRow({ id: v.id_base_origem ?? '', n: v.numero_documento ?? '', s: v.sacado_nome ?? '', v: v.valor_total ? Number(v.valor_total) : '', l: ROTULO_LADO[v.lado], d: v.nome_arquivo ?? '(sem PDF)', p: v.pagina ?? '', t: v.tipo_match === 'automatico' ? 'Automático' : 'Manual', e: new Date(v.criado_em).toLocaleString('pt-BR') });
  }
  zip.file('00_INDICE_AUDITORIA.xlsx', new Uint8Array(await livro.xlsx.writeBuffer()));
  zip.file('SHA256SUMS.txt', `${hashes.join('\n')}\n`);

  const cnpj = (base.cnpj_fundo ?? '').replace(/\D/g, '') || 'sem_cnpj';
  const quando = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '').replace(/^(\d{8})/, '$1_');
  return { nome: `documentos_auditoria_${cnpj}_${quando}.zip`, zip: await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' }) };
}
