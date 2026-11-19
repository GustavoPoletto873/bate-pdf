import ExcelJS from 'exceljs';
import { ErroDeUso } from '@/lib/api';
import type { Lado } from '@/lib/campos';
import type { TituloDaBase } from '@/lib/bates/preMatches';

/**
 * "Exportar pendências" de Resultados (services/pendencias_export_service.py), só o download:
 *
 * - Layout 1 (PENDENCIAS_BATE_LASTRO): aba "Planilha1", resumo do fundo e duas seções (Lastro,
 *   depois Termo) com uma linha por título × documento faltante; Observação fica livre.
 * - Layout 2 (consolidado): aba "LASTRO E TERMO", uma linha por título com P em algum lado.
 *
 * Pré-bate conta como atendido, como no resultado detalhado.
 */

export const MAX_LINHAS_PENDENCIAS = 100_000;
const MENSAGEM_LIMITE = 'Exportação bloqueada: acima de 100.000 linhas de pendências no layout selecionado. '
  + 'Filtre a base ou divida em partes antes de exportar.';

export type FundoPendencias = { nome_fundo: string | null; cnpj_fundo: string | null; data_referencia: string | null };

function data(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}
const dinheiro = (v: string | null | undefined) => (v === null || v === undefined || v === '' ? null : Number(v));
const idDoTitulo = (t: TituloDaBase) => String(t.id_base_origem ?? t.id);

/** Pendencias_{fundo}_{cnpj}[_{T}T{ano}]_{AAAA-MM-DD_HH-MM-SS}.xlsx (hora de São Paulo). */
export function nomeDoArquivoPendencias(fundo: FundoPendencias, agora = new Date()): string {
  let nome = String(fundo.nome_fundo || 'Fundo').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  nome = nome.split(/\s+/).join(' ').slice(0, 150).replace(/^[ .]+|[ .]+$/g, '') || 'Fundo';
  const cnpj = String(fundo.cnpj_fundo ?? '').replace(/\D/g, '') || 'sem_cnpj';
  const ref = data(fundo.data_referencia);
  const trimestre = ref ? `_${Math.floor(ref.getUTCMonth() / 3) + 1}T${ref.getUTCFullYear()}` : '';
  const partes = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(agora).map((p) => [p.type, p.value]));
  return `Pendencias_${nome}_${cnpj}${trimestre}_${partes.year}-${partes.month}-${partes.day}_${partes.hour}-${partes.minute}-${partes.second}.xlsx`;
}

const borda: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FF000000' } }, left: { style: 'thin', color: { argb: 'FF000000' } },
  bottom: { style: 'thin', color: { argb: 'FF000000' } }, right: { style: 'thin', color: { argb: 'FF000000' } },
};

type Estilo = 'header' | 'summary' | 'title' | 'text' | 'date' | 'money';
function estilizar(c: ExcelJS.Cell, e: Estilo) {
  c.font = { name: 'Calibri', size: 11, bold: e === 'header' || e === 'summary', color: { argb: e === 'header' ? 'FFFFFFFF' : 'FF000000' } };
  if (e !== 'title') c.border = borda;
  if (e === 'header') c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF00338D' } };
  c.alignment = { vertical: 'middle', wrapText: true, horizontal: e === 'header' || e === 'summary' ? 'center' : undefined };
  c.numFmt = e === 'text' ? '@' : e === 'date' ? 'dd/mm/yyyy' : e === 'money' ? '#,##0.00' : 'General';
}

const CABECALHOS = [null, 'Observação', null, 'Seu número', 'Data de aquisição', 'Número do título', 'Nome do sacado',
  'CPF/CNPJ do sacado', 'Nome do cedente', 'CNPJ do cedente', 'Data de vencimento', 'Valor do título - R$', 'Tipo do recebível', 'ID recebível'];
const LARGURAS = [3, 42, 3, 28, 18, 28, 48, 23, 48, 23, 18, 23, 30, 18];

/** Layout 1: uma linha por título × documento faltante (Lastro, depois Termo). */
export async function planilhaPendencias(fundo: FundoPendencias, faltantes: { lado: Lado; titulo: TituloDaBase }[]): Promise<Uint8Array> {
  if (faltantes.length > MAX_LINHAS_PENDENCIAS) throw new ErroDeUso(MENSAGEM_LIMITE, 413);
  const livro = new ExcelJS.Workbook();
  const ws = livro.addWorksheet('Planilha1', { views: [{ state: 'frozen', xSplit: 3, ySplit: 8, showGridLines: false }] });
  LARGURAS.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const contagem = { lastro: faltantes.filter((f) => f.lado === 'lastro').length, termo: faltantes.filter((f) => f.lado === 'termo').length };
  const escrever = (n: number, valores: (ExcelJS.CellValue | undefined)[], estilo: (i: number) => Estilo | null) => {
    const row = ws.getRow(n);
    valores.forEach((v, i) => {
      const e = estilo(i);
      if (e === null) return;
      const c = row.getCell(i + 1);
      c.value = v ?? null;
      estilizar(c, e);
    });
  };
  escrever(1, ['Fundo', null, null, 'CNPJ', null, null], () => 'header');
  escrever(2, [fundo.nome_fundo, null, null, fundo.cnpj_fundo, null, null], () => 'summary');
  escrever(4, ['Apontamento', null, null, 'Qdade'], () => 'header');
  escrever(5, ['Pendência', null, null, contagem.lastro + contagem.termo], () => 'summary');
  for (const m of ['A1:C1', 'D1:F1', 'A2:C2', 'D2:F2', 'A4:C4', 'A5:C5']) ws.mergeCells(m);

  let n = 7;
  (['lastro', 'termo'] as Lado[]).forEach((lado, secao) => {
    escrever(n, [`${secao + 1}.`, null, null, `${lado === 'lastro' ? 'Lastro' : 'Termo'} - ${contagem[lado]} itens:`], (i) => (i === 0 || i === 3 ? 'title' : null));
    ws.mergeCells(`D${n}:F${n}`);
    escrever(n + 1, CABECALHOS, (i) => (i === 1 || i >= 3 ? 'header' : null));
    ws.getRow(n + 1).height = 36;
    n += 2;
    for (const f of faltantes.filter((x) => x.lado === lado)) {
      const t = f.titulo;
      escrever(n++, [null, null, null, t.numero_documento, data(t.data_aquisicao), t.numero_documento, t.sacado_nome, t.sacado_documento,
        t.cedente_nome, t.cedente_documento, data(t.data_vencimento), dinheiro(t.valor_total), t.tipo_recebivel, idDoTitulo(t)],
      (i) => (i === 1 || i >= 3 ? (i === 4 || i === 10 ? 'date' : i === 11 ? 'money' : 'text') : null));
    }
    if (secao === 0) n++;
  });
  return new Uint8Array(await livro.xlsx.writeBuffer() as ArrayBuffer);
}

const CONSOLIDADO: [string, (t: TituloDaBase, e: { termo: string; lastro: string }) => ExcelJS.CellValue, number, 'text' | 'money' | 'date' | 'status'][] = [
  ['ID_BASE', (t) => idDoTitulo(t), 18, 'text'],
  ['STATUS TERMO', (_t, e) => e.termo, 18, 'status'],
  ['STATUS LASTRO', (_t, e) => e.lastro, 18, 'status'],
  ['BASE_NUMERO_DOC', (t) => t.numero_documento, 28, 'text'],
  ['BASE_NOME_SACADO', (t) => t.sacado_nome, 48, 'text'],
  ['BASE_DOC_SACADO', (t) => t.sacado_documento, 23, 'text'],
  ['BASE_NOME_CEDENTE', (t) => t.cedente_nome, 48, 'text'],
  ['BASE_DOC_CEDENTE', (t) => t.cedente_documento, 23, 'text'],
  ['BASE_NOME_FUNDO', (t) => t.nome_fundo, 48, 'text'],
  ['BASE_CNPJ_FUNDO', (t) => t.cnpj_fundo, 23, 'text'],
  ['BASE_VALOR_NOMINAL', (t) => dinheiro(t.valor_total), 25, 'money'],
  ['BASE_VALOR_AQUISICAO', (t) => dinheiro(t.valor_aquisicao), 25, 'money'],
  ['BASE_DATA_EMISSAO', (t) => data(t.data_emissao), 23, 'date'],
  ['BASE_DATA_VENCIMENTO', (t) => data(t.data_vencimento), 27, 'date'],
  ['BASE_DATA_AQUISICAO', (t) => data(t.data_aquisicao), 25, 'date'],
  ['BASE_CHAVE_NFE', (t) => t.chave_nfe, 52, 'text'],
  ['BASE_TIPO_RECEBIVEL', (t) => t.tipo_recebivel, 30, 'text'],
];

/** Layout 2: uma linha por título com P em Termo e/ou Lastro ('-' = lado não conferido nesta base). */
export async function planilhaPendenciasConsolidada(linhas: { titulo: TituloDaBase; termo: 'V' | 'P' | null; lastro: 'V' | 'P' | null }[]): Promise<Uint8Array> {
  if (linhas.length > MAX_LINHAS_PENDENCIAS) throw new ErroDeUso(MENSAGEM_LIMITE, 413);
  const livro = new ExcelJS.Workbook();
  const ws = livro.addWorksheet('LASTRO E TERMO', { views: [{ state: 'frozen', xSplit: 3, ySplit: 3, showGridLines: false }] });
  CONSOLIDADO.forEach(([, , w], i) => { ws.getColumn(i + 1).width = w; });
  const fino = { bottom: { style: 'thin' as const, color: { argb: 'FFD9E2F3' } } };
  const estilo = (c: ExcelJS.Cell, tipo: string) => {
    const destaque = tipo === 'header' || tipo === 'P' || tipo === 'V';
    c.font = { name: 'Calibri', size: 11, bold: destaque, color: { argb: tipo === 'header' ? 'FFFFFFFF' : 'FF000000' } };
    c.border = fino;
    c.alignment = { vertical: 'middle', wrapText: true, horizontal: destaque ? 'center' : undefined };
    c.numFmt = tipo === 'text' ? '@' : tipo === 'money' ? '#,##0.00' : tipo === 'date' ? 'dd/mm/yyyy' : 'General';
    if (destaque) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: tipo === 'header' ? 'FF366092' : tipo === 'P' ? 'FFFFB6C1' : 'FF90EE90' } };
  };
  ws.getCell('A1').value = 'DADOS TERMO E LASTRO';
  estilo(ws.getCell('A1'), 'header');
  ws.mergeCells('A1:Q1');
  ws.getCell('A2').value = 'P = Pendente | V = Atendido';
  estilo(ws.getCell('A2'), 'text');
  ws.mergeCells('A2:Q2');
  ws.getRow(3).height = 36;
  CONSOLIDADO.forEach(([h], i) => { const c = ws.getRow(3).getCell(i + 1); c.value = h; estilo(c, 'header'); });
  linhas.forEach((l, k) => {
    const row = ws.getRow(4 + k);
    const status = { termo: l.termo ?? '-', lastro: l.lastro ?? '-' };
    CONSOLIDADO.forEach(([, f, , tipo], i) => {
      const c = row.getCell(i + 1);
      const v = f(l.titulo, status);
      c.value = v ?? null;
      estilo(c, tipo === 'status' ? (v === 'P' || v === 'V' ? v : 'text') : tipo);
    });
  });
  ws.autoFilter = `A3:Q${Math.max(3, linhas.length + 3)}`;
  return new Uint8Array(await livro.xlsx.writeBuffer() as ArrayBuffer);
}
