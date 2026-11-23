import { randomUUID } from 'node:crypto';
import { gravarArquivo } from '@/lib/arquivos';
import { ErroDeUso } from '@/lib/api';
import { db, emBlocos, reservarIds, transacao, type Valor } from '@/lib/db';
import { receberPdfsComIds, type PdfRecebido } from '@/lib/indexacao';
import { listarLeituras, type Leitura } from '@/lib/leituras';
import {
  caminhoRelativo, chaveDaOperacao, extensao, EXTENSOES_ACEITAS, MAX_BYTES_ARQUIVO, MAX_BYTES_LOTE, MAX_DOCUMENTOS, nomeDoArquivo,
} from './caminhos';
import { imagemParaPdf, ImagemRecusada } from './imagem';
import { expandirZip, ZipRecusado } from './zip';
import { chutarFila } from './fila';

/**
 * Lotes do Anexo no banco (routes/post/anexo_batch.py + services/anexo_service.py do
 * Bate Lastro): o lote é criado com a base e o modo de agrupamento; os arquivos chegam em
 * levas pequenas; cada documento vira um job 'leitura_lastro' na fila local.
 */

const agora = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Etapas 1 e 2: bases do fundo no período
// ---------------------------------------------------------------------------

export type BaseDoAnexo = {
  id: string;
  nome: string;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  data_referencia: string | null;
  modo_referencia: string | null;
  fundo_id: number | null;
  titulos: number;
  leituras: number;
  documentos: number;
  previa: { numero_documento: string | null; sacado_nome: string | null; sacado_documento: string | null; cedente_nome: string | null; cedente_documento: string | null; valor_total: string | null }[];
};

/** Intervalo da busca: trimestre inteiro da data ou só o dia (intervalo_referencia do Bate Lastro). */
export function intervaloReferencia(data: string, modo: 'TRIMESTRE' | 'DATA_REFERENCIA'): [string, string] {
  if (modo === 'DATA_REFERENCIA') return [data, data];
  const [ano, mes] = data.split('-').map(Number);
  const tri = Math.floor((mes - 1) / 3);
  const inicio = `${ano}-${String(tri * 3 + 1).padStart(2, '0')}-01`;
  const fim = new Date(Date.UTC(ano, tri * 3 + 3, 0)).toISOString().slice(0, 10);
  return [inicio, fim];
}

type BaseCrua = Omit<BaseDoAnexo, 'titulos' | 'leituras' | 'documentos' | 'previa'>;

/** Contagens e prévia de várias bases com consultas agregadas (não quatro consultas por base). */
async function detalharBases(bases: BaseCrua[]): Promise<BaseDoAnexo[]> {
  if (!bases.length) return [];
  const c = await db();
  const titulos = new Map<string, number>();
  const leituras = new Map<string, number>();
  const documentos = new Map<string, number>();
  const previas = new Map<string, BaseDoAnexo['previa']>();
  for (const bloco of emBlocos(bases.map((b) => b.id), 200)) {
    const m = bloco.map(() => '?').join(',');
    for (const r of await c.prepare(`SELECT base_id, COUNT(*) n FROM titulos WHERE base_id IN (${m}) GROUP BY base_id`).all<{ base_id: string; n: number }>(...bloco)) titulos.set(r.base_id, r.n);
    for (const r of await c.prepare(`SELECT base_id, COUNT(*) n FROM leituras WHERE base_id IN (${m}) GROUP BY base_id`).all<{ base_id: string; n: number }>(...bloco)) leituras.set(r.base_id, r.n);
    for (const r of await c.prepare(`SELECT l.base_id, COUNT(*) n FROM anexo_documentos d JOIN anexo_lotes l ON l.id = d.lote_id
        WHERE l.base_id IN (${m}) GROUP BY l.base_id`).all<{ base_id: string; n: number }>(...bloco)) documentos.set(r.base_id, r.n);
    // Os 5 primeiros títulos de cada base.
    for (const r of await c.prepare(`SELECT base_id, numero_documento, sacado_nome, sacado_documento, cedente_nome, cedente_documento, valor_total
        FROM (SELECT t.*, ROW_NUMBER() OVER (PARTITION BY base_id ORDER BY id) AS ordem FROM titulos t WHERE base_id IN (${m}))
        WHERE ordem <= 5 ORDER BY base_id, ordem`).all<BaseDoAnexo['previa'][number] & { base_id: string }>(...bloco)) {
      const { base_id, ...titulo } = r;
      const lista = previas.get(base_id) ?? [];
      lista.push(titulo);
      previas.set(base_id, lista);
    }
  }
  return bases.map((b) => ({
    ...b,
    titulos: titulos.get(b.id) ?? 0,
    leituras: leituras.get(b.id) ?? 0,
    documentos: documentos.get(b.id) ?? 0,
    previa: previas.get(b.id) ?? [],
  }));
}

const SELECT_BASE = 'SELECT id, nome, nome_fundo, cnpj_fundo, data_referencia, modo_referencia, fundo_id FROM bases';

/** Bases de um fundo no período (Buscar Operações), ou todas, ou uma (por id). */
export async function buscarBases(f: { id?: string; fundoId?: number; data?: string; modo?: 'TRIMESTRE' | 'DATA_REFERENCIA' }): Promise<BaseDoAnexo[]> {
  const c = await db();
  if (f.id) {
    const b = await c.prepare(`${SELECT_BASE} WHERE id = ?`).get<BaseCrua>(f.id);
    return b ? detalharBases([b]) : [];
  }
  const onde: string[] = [];
  const args: (string | number)[] = [];
  if (f.fundoId) {
    const fundo = await c.prepare('SELECT cnpj FROM fundos WHERE id = ?').get<{ cnpj: string }>(f.fundoId);
    if (!fundo) throw new ErroDeUso('Fundo não encontrado.', 404);
    onde.push("(fundo_id = ? OR REPLACE(REPLACE(REPLACE(COALESCE(cnpj_fundo, ''), '.', ''), '/', ''), '-', '') = ?)");
    args.push(f.fundoId, fundo.cnpj);
  }
  if (f.data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.data)) throw new ErroDeUso('Data de referência inválida.');
    const [ini, fim] = intervaloReferencia(f.data, f.modo ?? 'DATA_REFERENCIA');
    onde.push('data_referencia BETWEEN ? AND ?');
    args.push(ini, fim);
  }
  const sql = `${SELECT_BASE}${onde.length ? ` WHERE ${onde.join(' AND ')}` : ''} ORDER BY data_referencia DESC, criado_em DESC LIMIT 200`;
  return detalharBases(await c.prepare(sql).all<BaseCrua>(...args));
}

// ---------------------------------------------------------------------------
// Etapa 3: lote, arquivos, documentos e jobs
// ---------------------------------------------------------------------------

export async function criarLote(baseId: string, agrupar: boolean): Promise<string> {
  const c = await db();
  const base = await c.prepare('SELECT id, fundo_id FROM bases WHERE id = ?').get<{ id: string; fundo_id: number | null }>(baseId);
  if (!base) throw new ErroDeUso('Base não encontrada.', 404);
  const id = randomUUID();
  await c.prepare('INSERT INTO anexo_lotes (id, base_id, fundo_id, agrupar_por_pasta, total_documentos, criado_em) VALUES (?, ?, ?, ?, 0, ?)')
    .run(id, baseId, base.fundo_id, agrupar ? 1 : 0, agora());
  return id;
}

export type ArquivoEnviado = { caminho: string; bytes: Uint8Array };
export type Recusado = { caminho: string; motivo: string };

type Lote = { id: string; base_id: string; agrupar_por_pasta: number; total_documentos: number; total_bytes: number };

type Preparado = { caminho: string; origem: string; ext: string; bytes: Uint8Array; operacao: { chave: string; nome: string | null; pasta: string | null } };

async function obterLoteBruto(loteId: string): Promise<Lote> {
  const lote = await (await db()).prepare('SELECT id, base_id, agrupar_por_pasta, total_documentos, total_bytes FROM anexo_lotes WHERE id = ?').get<Lote>(loteId);
  if (!lote || !lote.base_id) throw new ErroDeUso('Lote não encontrado.', 404);
  return lote;
}

/** Recebe uma leva de arquivos do lote: abre ZIPs, confere caminhos e limites, grava e enfileira. */
export async function adicionarArquivos(loteId: string, arquivos: ArquivoEnviado[]): Promise<{ documentos: number; recusados: Recusado[] }> {
  const lote = await obterLoteBruto(loteId);
  const agrupar = lote.agrupar_por_pasta === 1;
  const recusados: Recusado[] = [];
  const candidatos: { caminho: string; origem: string; bytes: Uint8Array }[] = [];

  for (const a of arquivos) {
    let caminho: string;
    try {
      caminho = caminhoRelativo(a.caminho);
    } catch {
      recusados.push({ caminho: a.caminho, motivo: 'Caminho inválido' });
      continue;
    }
    const ext = extensao(caminho);
    if (!EXTENSOES_ACEITAS.includes(ext)) {
      recusados.push({ caminho, motivo: 'Formato não suportado (envie PDF, XML, JPG, PNG ou ZIP)' });
      continue;
    }
    if (ext === '.zip') {
      try {
        candidatos.push(...await expandirZip(a.bytes, caminho, { ler: true }));
      } catch (e) {
        recusados.push({ caminho, motivo: e instanceof ZipRecusado ? e.message : 'ZIP inválido ou corrompido' });
      }
      continue;
    }
    if (a.bytes.length > MAX_BYTES_ARQUIVO) {
      recusados.push({ caminho, motivo: 'Arquivo excede 50 MB' });
      continue;
    }
    candidatos.push({ caminho, origem: caminho, bytes: a.bytes });
  }

  // Repetidos no lote (mesmo caminho, sem diferenciar maiúsculas) e limites do lote.
  const existentes = new Set((await (await db()).prepare('SELECT LOWER(caminho) c FROM anexo_documentos WHERE lote_id = ?').all<{ c: string }>(loteId)).map((r) => r.c));
  let total = lote.total_documentos;
  let bytes = lote.total_bytes;
  const preparados: Preparado[] = [];
  for (const c of candidatos) {
    const chave = c.caminho.toLowerCase();
    if (existentes.has(chave)) { recusados.push({ caminho: c.caminho, motivo: 'Caminho duplicado no lote' }); continue; }
    if (total + 1 > MAX_DOCUMENTOS) { recusados.push({ caminho: c.caminho, motivo: `Lote excede ${MAX_DOCUMENTOS} documentos` }); continue; }
    if (bytes + c.bytes.length > MAX_BYTES_LOTE) { recusados.push({ caminho: c.caminho, motivo: 'Lote excede 250 MB' }); continue; }
    const operacao = chaveDaOperacao(c.caminho, agrupar);
    if (!operacao) {
      recusados.push({ caminho: c.caminho, motivo: 'Arquivo fora de uma pasta de operação. Selecione a pasta ou desligue o agrupamento.' });
      continue;
    }
    let ext = extensao(c.caminho);
    let conteudo = c.bytes;
    if (ext === '.jpg' || ext === '.jpeg' || ext === '.png') {
      try {
        conteudo = imagemParaPdf(c.bytes, ext);
        ext = '.pdf';
      } catch (e) {
        recusados.push({ caminho: c.caminho, motivo: e instanceof ImagemRecusada ? e.message : 'Imagem inválida. Converta para PDF e envie de novo.' });
        continue;
      }
    }
    existentes.add(chave);
    total++;
    bytes += c.bytes.length;
    preparados.push({ caminho: c.caminho, origem: c.origem, ext, bytes: conteudo, operacao });
  }

  // PDFs entram na base (e na indexação de texto do Bater PDF) pelo mesmo caminho do envio comum.
  const pdfs = preparados.filter((p) => p.ext === '.pdf');
  const recebidos: PdfRecebido[] = pdfs.map((p) => {
    const nome = nomeDoArquivo(p.caminho);
    return { nome: extensao(nome) === '.pdf' ? nome : `${nome.replace(/\.[^.]+$/, '')}.pdf`, caminhoRelativo: p.caminho, bytes: p.bytes };
  });
  const gravados = recebidos.length ? await receberPdfsComIds(lote.base_id, recebidos) : [];
  const pdfDe = new Map<Preparado, number>();
  pdfs.forEach((p, i) => {
    const g = gravados[i];
    if ('pdf_id' in g) pdfDe.set(p, g.pdf_id);
    else recusados.push({ caminho: p.caminho, motivo: 'O arquivo não é um PDF válido' });
  });

  const aceitos = preparados.filter((p) => p.ext !== '.pdf' || pdfDe.has(p));
  const momento = agora();
  // XMLs vão para o disco antes da transação (a transação só grava as linhas).
  const arquivoDe = new Map<Preparado, string>();
  for (const p of aceitos) {
    if (p.ext !== '.xml') continue;
    const arquivo = `anexos/${loteId}/${randomUUID()}.xml`;
    await gravarArquivo(arquivo, p.bytes, 'application/xml');
    arquivoDe.set(p, arquivo);
  }
  await transacao(async (tx) => {
    const ops = new Map((await tx.prepare('SELECT chave, id FROM anexo_operacoes WHERE lote_id = ?').all<{ chave: string; id: string }>(loteId)).map((r) => [r.chave, r.id]));
    // Ids dos documentos reservados: operação, documento e job de cada arquivo vão num lote só.
    let docId = await reservarIds(tx, 'anexo_documentos', aceitos.length);
    const comandos: { sql: string; args: Valor[] }[] = [];
    for (const p of aceitos) {
      let op = ops.get(p.operacao.chave);
      if (!op) {
        op = randomUUID();
        ops.set(p.operacao.chave, op);
        comandos.push({ sql: 'INSERT INTO anexo_operacoes (id, lote_id, chave, nome, caminho) VALUES (?, ?, ?, ?, ?)', args: [op, loteId, p.operacao.chave, p.operacao.nome, p.operacao.pasta] });
      }
      comandos.push({
        sql: `INSERT INTO anexo_documentos (id, lote_id, operacao_id, pdf_id, caminho, nome_arquivo, extensao, status, origem, tamanho, arquivo, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'enfileirado', ?, ?, ?, ?, ?)`,
        args: [docId, loteId, op, pdfDe.get(p) ?? null, p.caminho, nomeDoArquivo(p.caminho), extensao(p.caminho), p.origem, p.bytes.length, arquivoDe.get(p) ?? null, momento, momento],
      });
      comandos.push({
        sql: "INSERT INTO jobs (tipo, base_id, documento_id, status, criado_em, atualizado_em) VALUES ('leitura_lastro', ?, ?, 'pending', ?, ?)",
        args: [lote.base_id, docId, momento, momento],
      });
      docId++;
    }
    comandos.push({
      sql: 'UPDATE anexo_lotes SET total_documentos = total_documentos + ?, total_bytes = total_bytes + ? WHERE id = ?',
      args: [aceitos.length, aceitos.reduce((s, p) => s + p.bytes.length, 0), loteId],
    });
    for (const bloco of emBlocos(comandos, 200)) await tx.lote(bloco);
  });
  if (aceitos.length) chutarFila();
  return { documentos: aceitos.length, recusados };
}

// ---------------------------------------------------------------------------
// Acompanhamento do lote na tela
// ---------------------------------------------------------------------------

export type DocumentoDoLote = {
  id: number;
  caminho: string;
  nome_arquivo: string;
  origem: string | null;
  operacao_id: string | null;
  operacao: string | null;
  pdf_id: number | null;
  status: string;
  tipo_documento: string | null;
  motivo: string | null;
  paginas: number | null;
  leituras: number;
  atualizado_em: string;
};

export const STATUS_FINAIS = ['lido', 'somente_classificado', 'erro'];

export async function documentosDoLote(loteId: string): Promise<DocumentoDoLote[]> {
  return (await db()).prepare(`SELECT d.id, d.caminho, d.nome_arquivo, d.origem, d.operacao_id, COALESCE(o.nome, NULL) AS operacao, d.pdf_id, d.status,
      d.tipo_documento, d.motivo, d.paginas, (SELECT COUNT(*) FROM leituras l WHERE l.documento_id = d.id) AS leituras, d.atualizado_em
    FROM anexo_documentos d LEFT JOIN anexo_operacoes o ON o.id = d.operacao_id
    WHERE d.lote_id = ? ORDER BY d.caminho COLLATE NOCASE`).all<DocumentoDoLote>(loteId);
}

export async function obterLote(loteId: string): Promise<{
  lote: { id: string; base_id: string; agrupar_por_pasta: boolean; total_documentos: number; criado_em: string };
  documentos: DocumentoDoLote[];
  leituras: Leitura[];
  resumo: Record<string, number>;
}> {
  const lote = await (await db()).prepare('SELECT id, base_id, agrupar_por_pasta, total_documentos, criado_em FROM anexo_lotes WHERE id = ?')
    .get<{ id: string; base_id: string; agrupar_por_pasta: number; total_documentos: number; criado_em: string }>(loteId);
  if (!lote) throw new ErroDeUso('Lote não encontrado.', 404);
  const documentos = await documentosDoLote(loteId);
  const ids = new Set(documentos.map((d) => d.id));
  const leituras = (await listarLeituras(lote.base_id)).filter((l) => l.documento_id !== null && ids.has(l.documento_id));
  const resumo: Record<string, number> = {};
  for (const d of documentos) resumo[d.status] = (resumo[d.status] ?? 0) + 1;
  return { lote: { ...lote, agrupar_por_pasta: lote.agrupar_por_pasta === 1 }, documentos, leituras, resumo };
}

/** "Tentar de novo": documentos com erro voltam para a fila (cada tentativa é cobrada de novo). */
export async function tentarDeNovo(documentoIds: number[], situacoes: string[] = ['erro']): Promise<number> {
  if (!documentoIds.length) return 0;
  const momento = agora();
  const n = await transacao(async (tx) => {
    let total = 0;
    for (const bloco of emBlocos([...new Set(documentoIds)])) {
      const m = bloco.map(() => '?').join(',');
      const docs = await tx.prepare(`SELECT d.id, l.base_id, (SELECT MAX(j.id) FROM jobs j WHERE j.documento_id = d.id) AS job_id
        FROM anexo_documentos d JOIN anexo_lotes l ON l.id = d.lote_id
        WHERE d.id IN (${m}) AND d.status IN (${situacoes.map(() => '?').join(',')})`)
        .all<{ id: number; base_id: string; job_id: number | null }>(...bloco, ...situacoes);
      const comandos: { sql: string; args: Valor[] }[] = [];
      for (const doc of docs) {
        comandos.push({ sql: "UPDATE anexo_documentos SET status = 'enfileirado', motivo = NULL, atualizado_em = ? WHERE id = ?", args: [momento, doc.id] });
        if (doc.job_id) comandos.push({ sql: "UPDATE jobs SET status = 'pending', erro = NULL, atualizado_em = ? WHERE id = ?", args: [momento, doc.job_id] });
        else comandos.push({ sql: "INSERT INTO jobs (tipo, base_id, documento_id, status, criado_em, atualizado_em) VALUES ('leitura_lastro', ?, ?, 'pending', ?, ?)", args: [doc.base_id, doc.id, momento, momento] });
      }
      await tx.lote(comandos);
      total += docs.length;
    }
    return total;
  });
  if (n) chutarFila();
  return n;
}

/** "Ler de novo" depois de treinar um tipo: vale também para o que só foi classificado. */
export async function lerDeNovo(documentoIds: number[]): Promise<number> {
  return tentarDeNovo(documentoIds, ['erro', 'somente_classificado']);
}

/** Ids dos documentos com erro de uma base (Tentar todos de novo). */
export async function documentosComErro(baseId: string): Promise<number[]> {
  return (await (await db()).prepare(`SELECT d.id FROM anexo_documentos d JOIN anexo_lotes l ON l.id = d.lote_id
    WHERE l.base_id = ? AND d.status = 'erro'`).all<{ id: number }>(baseId)).map((r) => r.id);
}

// ---------------------------------------------------------------------------
// Reaproveitar Leitura de outra Base (reaproveitamento_leitura_service, modo manual)
// ---------------------------------------------------------------------------

/** Chave do título: o mesmo título lido em mais de uma base entra uma vez só. */
const CHAVE_TITULO = ['numero_documento', 'numero_parcela', 'data_vencimento', 'valor_nominal', 'tipo_recebivel', 'sacado_documento', 'cedente_documento'];

/**
 * Copia para `destino` as leituras de `origem` (mesmo fundo), sem as da planilha e sem
 * repetir título que o destino já tem. A cópia entra com lida_em = agora.
 */
export async function reaproveitarLeituras(origem: string, destino: string): Promise<number> {
  if (origem === destino) throw new ErroDeUso('As bases de origem e destino não podem ser as mesmas.');
  const c = await db();
  const bases = await c.prepare('SELECT id, fundo_id, cnpj_fundo FROM bases WHERE id IN (?, ?)').all<{ id: string; fundo_id: number | null; cnpj_fundo: string | null }>(origem, destino);
  const o = bases.find((b) => b.id === origem);
  const d = bases.find((b) => b.id === destino);
  if (!o || !d) throw new ErroDeUso('Base não encontrada.', 404);
  const digitos = (s: string | null) => (s ?? '').replace(/\D/g, '');
  const mesmoFundo = (o.fundo_id && o.fundo_id === d.fundo_id) || (digitos(o.cnpj_fundo) && digitos(o.cnpj_fundo) === digitos(d.cnpj_fundo));
  if (!mesmoFundo) throw new ErroDeUso('As duas bases precisam ser do mesmo fundo.');
  const colunas = ['pdf_id', 'documento_id', 'operacao_id', 'tipo_documento', 'tipo_recebivel', 'numero_documento', 'sacado_nome', 'sacado_documento',
    'cedente_nome', 'cedente_documento', 'cessionario_nome', 'cessionario_documento', 'valor_nominal', 'data_aquisicao', 'data_emissao',
    'data_vencimento', 'numero_parcela', 'quantidade_parcelas', 'ente_consignante', 'origem', 'dados'];
  const igual = CHAVE_TITULO.map((k) => `d.${k} IS o.${k}`).join(' AND ');
  // Um comando só (INSERT … SELECT): já é atômico, não precisa de transação.
  {
    const r = await c.prepare(`INSERT INTO leituras (base_id, ${colunas.join(', ')}, lida_em)
      SELECT ?, ${colunas.map((k) => (k === 'documento_id' ? 'NULL' : `o.${k}`)).join(', ')}, ?
      FROM leituras o
      WHERE o.base_id = ? AND o.origem <> 'planilha'
        AND o.id = (SELECT MAX(o2.id) FROM leituras o2 WHERE o2.base_id = o.base_id AND ${CHAVE_TITULO.map((k) => `o2.${k} IS o.${k}`).join(' AND ')})
        AND NOT EXISTS (SELECT 1 FROM leituras d WHERE d.base_id = ? AND ${igual})`).run(destino, agora(), origem, destino);
    return Number(r.changes);
  }
}
