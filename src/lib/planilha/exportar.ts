import ExcelJS from 'exceljs';
import { camposDoLado, CAMPOS, type CampoId, type Lado, type TituloAmostra, type Veredito } from '@/lib/campos';
import { vereditosDoLado } from '@/lib/bates/comparacao';
import { formatarData } from '@/lib/valores';

/**
 * Gera o resultados_matching_<CNPJ>_<AAAAMMDD_HHMMSS>.xlsx igual ao "Exportar para Excel" de
 * Resultados do Bate Lastro (gerar_planilha_resultados / _create_data_sheet em
 * backend/routes/get/export_excel.py), que é o arquivo que o "Inserir Resultado" (ler_planilha em
 * importar_resultado_matching_service.py) lê de volta:
 *
 * - abas "Resumo Executivo", "TERMO" e "LASTRO"; "DADOS TERMO"/"DADOS LASTRO" em A1 e o
 *   cabeçalho na linha 3 (o importador procura ID_BASE nas 10 primeiras linhas);
 * - STATUS V = vínculo ou pré-bate (o pré-bate sai como V, como lá); P = nenhum;
 * - DIV_* = calc_divergencia entre base e leitura, com o veredito salvo valendo mais;
 * - ID_BASE quando a base veio do resultados_matching (é o id de lá); senão vazio, e o importador
 *   acha o título por BASE_NUMERO_DOC + BASE_VALOR_NOMINAL (desde que seja único);
 * - CNPJ do fundo no nome do arquivo e em BASE_CNPJ_FUNDO (sem ele, o importador recusa).
 *
 * As colunas extras no fim (PDF_ARQUIVO, PDF_PAGINA, ORIGEM_BATE_PDF) são ignoradas pelo
 * importador e servem de rastro do documento conferido aqui.
 */

export type LinhaExportacao = {
  lado: Lado;
  titulo: TituloAmostra & { id_base_origem: number | null };
  status: 'V' | 'P';
  /** Vereditos salvos (valem mais que a comparação). */
  marcacoes: Partial<Record<CampoId, Veredito>>;
  leitura: Partial<Record<CampoId, string | null>>;
  pdf?: { nome: string; pagina: number | null } | null;
  origem?: string | null;
  /** Veio batido do Bate Lastro: STATUS V, sem leitura nem DIV_* (o importador de lá não mexe). */
  jaBatido?: boolean;
  /** Coluna BLACKLIST ('Não', 'Cedente', 'Sacado', 'Cedente / Sacado'). */
  blacklist?: string;
};

// Mesma ordem de all_headers em _create_data_sheet.
const TODAS = [
  'ID_BASE', 'STATUS', 'BASE_NUMERO_DOC', 'BASE_NOME_SACADO', 'BASE_DOC_SACADO', 'BASE_NOME_CEDENTE',
  'BASE_DOC_CEDENTE', 'BASE_NOME_FUNDO', 'BASE_CNPJ_FUNDO', 'BASE_VALOR_NOMINAL', 'BASE_VALOR_AQUISICAO',
  'BASE_DATA_EMISSAO', 'BASE_DATA_VENCIMENTO', 'BASE_DATA_AQUISICAO', 'BASE_CHAVE_NFE', 'BASE_TIPO_RECEBIVEL',
  'LEITURA_NUMERO_DOC', 'LEITURA_NOME_SACADO', 'LEITURA_DOC_SACADO', 'LEITURA_NOME_CEDENTE', 'LEITURA_DOC_CEDENTE',
  'LEITURA_NOME_CESSIONARIO', 'LEITURA_DOC_CESSIONARIO', 'LEITURA_DATA_AQUISICAO', 'LEITURA_VALOR_NOMINAL',
  'LEITURA_DATA_EMISSAO', 'LEITURA_DATA_VENCIMENTO',
  'DIV_NUMERO_DOC', 'DIV_NOME_SACADO', 'DIV_DOC_SACADO', 'DIV_NOME_CEDENTE', 'DIV_DOC_CEDENTE',
  'DIV_NOME_CESSIONARIO', 'DIV_DOC_CESSIONARIO', 'DIV_DATA_AQUISICAO', 'DIV_VALOR_NOMINAL', 'DIV_DATA_EMISSAO',
  'DIV_DATA_VENCIMENTO',
  'STATUS_NFE', 'LASTRO_GARANTIA', 'LASTRO_GARANTIA_PALAVRAS', 'BLACKLIST',
];
const SO_TERMO = new Set([
  'BASE_NOME_FUNDO', 'BASE_CNPJ_FUNDO', 'LEITURA_NOME_CESSIONARIO', 'LEITURA_DOC_CESSIONARIO',
  'LEITURA_DATA_AQUISICAO', 'DIV_NOME_CESSIONARIO', 'DIV_DOC_CESSIONARIO', 'DIV_DATA_AQUISICAO',
]);
const SO_LASTRO = new Set(['STATUS_NFE', 'LASTRO_GARANTIA', 'LASTRO_GARANTIA_PALAVRAS']);
const EXTRAS = ['PDF_ARQUIVO', 'PDF_PAGINA', 'ORIGEM_BATE_PDF'];

export function cabecalhoDaAba(lado: Lado): string[] {
  return [
    ...TODAS.filter((h) => !(lado !== 'termo' && SO_TERMO.has(h)) && !(lado !== 'lastro' && SO_LASTRO.has(h))),
    ...EXTRAS,
  ];
}

/** float(...) com 0.0 no vazio, como o export de lá. */
function numeroOuZero(v: string | null | undefined): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const vazio = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : v);

function valorDaCelula(coluna: string, linha: LinhaExportacao, vereditos: Partial<Record<CampoId, Veredito>>): ExcelJS.CellValue {
  const t = linha.titulo;
  const def = CAMPOS.find((c) => c.colunaLeitura === coluna || c.colunaDiv === coluna);
  if (def) {
    if (coluna === def.colunaDiv) return linha.jaBatido ? null : (vereditos[def.campo] ?? 'P');
    const valor = linha.leitura[def.campo];
    if (def.tipo === 'moeda') return numeroOuZero(valor);
    if (valor === null || valor === undefined || valor === '') return null;
    if (def.tipo === 'data') return formatarData(valor) || null;
    return valor;
  }
  switch (coluna) {
    case 'ID_BASE': return t.id_base_origem ?? null;
    case 'STATUS': return linha.status;
    case 'BASE_NUMERO_DOC': return vazio(t.numero_documento);
    case 'BASE_NOME_SACADO': return vazio(t.sacado_nome);
    case 'BASE_DOC_SACADO': return vazio(t.sacado_documento);
    case 'BASE_NOME_CEDENTE': return vazio(t.cedente_nome);
    case 'BASE_DOC_CEDENTE': return vazio(t.cedente_documento);
    case 'BASE_NOME_FUNDO': return vazio(t.nome_fundo);
    case 'BASE_CNPJ_FUNDO': return vazio(t.cnpj_fundo);
    case 'BASE_VALOR_NOMINAL': return numeroOuZero(t.valor_total);
    case 'BASE_VALOR_AQUISICAO': return numeroOuZero(t.valor_aquisicao);
    case 'BASE_DATA_EMISSAO': return formatarData(t.data_emissao) || null;
    case 'BASE_DATA_VENCIMENTO': return formatarData(t.data_vencimento) || null;
    case 'BASE_DATA_AQUISICAO': return formatarData(t.data_aquisicao) || null;
    case 'BASE_CHAVE_NFE': return vazio(t.chave_nfe);
    case 'BASE_TIPO_RECEBIVEL': return vazio(t.tipo_recebivel);
    // Sem consulta de NF-e nem "Validar Garantia" nesta versão: os mesmos textos de lá para "não consultado".
    case 'STATUS_NFE': return 'N/A';
    case 'LASTRO_GARANTIA': return 'Não validado';
    case 'LASTRO_GARANTIA_PALAVRAS': return 'Não validado';
    case 'BLACKLIST': return linha.blacklist ?? 'Não';
    case 'PDF_ARQUIVO': return linha.pdf?.nome ?? null;
    case 'PDF_PAGINA': return linha.pdf?.pagina ?? null;
    case 'ORIGEM_BATE_PDF': return linha.origem ?? null;
    default: return null;
  }
}

// _formatos: V verde, D amarelo, P rosa; cabeçalho branco em azul.
const COR: Record<string, string> = { V: 'FF90EE90', D: 'FFFFFF99', P: 'FFFFB6C1' };
const AZUL = 'FF366092';
const pad = (n: number) => String(n).padStart(2, '0');

/** resultados_matching_{CNPJ}_{AAAAMMDD_HHMMSS}.xlsx (hora local, como o datetime.now() de lá). */
export function nomeDoArquivo(cnpjFundo: string | null, agora = new Date()): string {
  const cnpj = String(cnpjFundo ?? '').replace(/\D/g, '');
  const carimbo = `${agora.getFullYear()}${pad(agora.getMonth() + 1)}${pad(agora.getDate())}_${pad(agora.getHours())}${pad(agora.getMinutes())}${pad(agora.getSeconds())}`;
  // O importador tira o CNPJ do nome: "resultados_matching_(\d{14})_".
  return `resultados_matching_${cnpj.length === 14 ? cnpj : 'SEM-CNPJ'}_${carimbo}.xlsx`;
}

function dataHora(d: Date): string {
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export async function gerarPlanilhaResultados(
  linhas: LinhaExportacao[],
  resumo: { nome: string; cnpj: string | null; geradoEm: Date; nomeFundo?: string | null; dataReferencia?: string | null },
): Promise<Uint8Array> {
  const livro = new ExcelJS.Workbook();
  livro.creator = 'Lastro (versão local)';

  // ------------------------------------------------------------- Resumo Executivo
  const capa = livro.addWorksheet('Resumo Executivo', { views: [{ showGridLines: false }] });
  capa.mergeCells('A1:G1');
  capa.getCell('A1').value = `RESULTADOS MATCHING - ${resumo.nomeFundo || 'N/A'} - ${formatarData(resumo.dataReferencia) || 'N/A'}`;
  capa.getCell('A1').font = { bold: true, size: 16 };
  capa.getCell('A1').alignment = { horizontal: 'center' };
  capa.getCell('A2').value = `Gerado em: ${dataHora(resumo.geradoEm)}`;
  capa.getCell('A2').font = { italic: true, size: 10 };
  const contar = (lado: Lado) => {
    const v = linhas.filter((l) => l.lado === lado && l.status === 'V').length;
    const p = linhas.filter((l) => l.lado === lado && l.status !== 'V').length;
    return { v, p, total: v + p };
  };
  const taxa = (v: number, total: number) => `${(total > 0 ? (v / total) * 100 : 0).toFixed(1)}%`;
  const termo = contar('termo');
  const lastro = contar('lastro');
  const cab = capa.getRow(5);
  ['Categoria', 'Confirmados (V)', 'Pendentes (P)', 'Total', 'Taxa Sucesso'].forEach((h, i) => {
    const c = cab.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
  });
  capa.getRow(6).values = ['TERMO', termo.v, termo.p, termo.total, taxa(termo.v, termo.total)];
  capa.getRow(7).values = ['LASTRO', lastro.v, lastro.p, lastro.total, taxa(lastro.v, lastro.total)];
  const tv = termo.v + lastro.v;
  const tt = termo.total + lastro.total;
  const total = capa.getRow(8);
  total.values = ['TOTAL', tv, tt - tv, tt, taxa(tv, tt)];
  for (let i = 1; i <= 5; i++) {
    total.getCell(i).font = { bold: true };
    total.getCell(i).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } };
  }
  [14, 18, 16, 10, 14].forEach((w, i) => { capa.getColumn(i + 1).width = w; });

  // ------------------------------------------------------------- TERMO / LASTRO
  for (const lado of ['termo', 'lastro'] as Lado[]) {
    const tipo = lado === 'termo' ? 'TERMO' : 'LASTRO';
    const aba = livro.addWorksheet(tipo, { views: [{ state: 'frozen', ySplit: 3, showGridLines: false }] });
    const cabecalho = cabecalhoDaAba(lado);
    aba.getCell('A1').value = `DADOS ${tipo}`;
    aba.getCell('A1').font = { bold: true, size: 14, color: { argb: 'FFFFFFFF' } };
    aba.getCell('A1').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    const linhaCab = aba.getRow(3);
    cabecalho.forEach((h, i) => {
      const c = linhaCab.getCell(i + 1);
      c.value = h;
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL } };
    });
    const larguras = cabecalho.map((h) => h.length + 2);
    let n = 4;
    for (const linha of linhas.filter((l) => l.lado === lado)) {
      const vereditos = vereditosDoLado(lado, linha.titulo, linha.leitura, linha.marcacoes);
      const row = aba.getRow(n++);
      cabecalho.forEach((h, i) => {
        const cel = row.getCell(i + 1);
        const v = valorDaCelula(h, linha, vereditos);
        cel.value = v;
        if (h === 'BLACKLIST') {
          if (v !== 'Não') {
            cel.font = { bold: true, color: { argb: 'FF9C0006' } };
            cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFC7CE' } };
          }
        } else if (typeof v === 'string' && v in COR) {
          cel.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COR[v] } };
        }
        if (v !== null && v !== undefined) larguras[i] = Math.max(larguras[i], String(v).length + 2);
      });
    }
    larguras.forEach((w, i) => { aba.getColumn(i + 1).width = Math.min(Math.max(w, 10), 50); });
  }

  const buffer = await livro.xlsx.writeBuffer();
  return new Uint8Array(buffer as ArrayBuffer);
}

/** Campos do lado que entram nas colunas LEITURA_/DIV_ (para quem monta as linhas). */
export function camposExportados(lado: Lado): CampoId[] {
  return camposDoLado(lado).map((c) => c.campo);
}
