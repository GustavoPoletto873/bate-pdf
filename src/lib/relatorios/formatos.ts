import type { Contexto } from './docx';
import type { Snapshot } from './snapshot';

/**
 * Formatos impressos nos relatórios e o contexto de substituição dos modelos — porta de
 * fmt_* / construir_contexto / _listas de services/Relatorios/docx_service.py do Bate Lastro.
 */

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const DIAS = ['Domingo', 'Segunda-Feira', 'Terça-Feira', 'Quarta-Feira', 'Quinta-Feira', 'Sexta-Feira', 'Sábado'];

/** Chaves que são contagens (inteiros), não dinheiro. */
const CONTAGENS = new Set(['quantidade', 'total_quantidade', 'total', 'verificados', 'pendentes', 'divergentes', 'operacoes',
  'entidades_monitoradas', 'total_ocorrencias', 'total_linhas', 'id', 'quantidade_cotas']);

const milhar = (inteiro: string) => inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

export function fmtMoeda(valor: unknown): string {
  const n = Number(valor ?? 0);
  if (!Number.isFinite(n)) return String(valor ?? '');
  const [i, d] = Math.abs(n).toFixed(2).split('.');
  return `${n < 0 ? '-' : ''}${milhar(i)},${d}`;
}

export function fmtPercentual(valor: unknown, casas = 2): string {
  const n = Number(valor ?? 0) * 100;
  if (!Number.isFinite(n)) return String(valor ?? '');
  const [i, d] = Math.abs(n).toFixed(casas).split('.');
  return `${n < 0 ? '-' : ''}${milhar(i)}${d ? `,${d}` : ''}%`;
}

export function fmtData(valor: unknown): string {
  const s = String(valor ?? '').trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : s;
}

export function dataPorExtenso(d: Date): string {
  return `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
}

/** Formato das planilhas: traço no zero, negativos entre parênteses, `n/i` sem dado. */
export function fmtContabil(valor: unknown, quantidade = false): string {
  if (valor === null || valor === undefined) return 'n/i';
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor);
  if (n === 0) return '-';
  const abs = quantidade ? milhar(String(Math.trunc(Math.abs(n)))) : fmtMoeda(Math.abs(n));
  return n < 0 ? `(${abs})` : abs;
}

const ultimo = (chave: string) => chave.split('.').pop()!;
const ehContagem = (chave: string) => CONTAGENS.has(ultimo(chave));

function formatarValor(chave: string, valor: unknown): string {
  if (typeof valor === 'boolean') return valor ? 'Sim' : 'Não';
  if (typeof valor === 'number') {
    if (chave.includes('percentual')) return fmtPercentual(valor);
    return ehContagem(chave) ? String(Math.trunc(valor)) : fmtMoeda(valor);
  }
  return valor === null || valor === undefined ? '' : String(valor);
}

function aliasesContabeis(dados: Record<string, unknown>): Contexto {
  const saida: Contexto = {};
  for (const [chave, valor] of Object.entries(dados)) {
    if (typeof valor === 'number' && !chave.includes('percentual')) {
      saida[`${chave}_contabil`] = fmtContabil(valor, ehContagem(chave));
      saida[`${chave}_reais`] = `R$ ${fmtContabil(valor)}`;
    }
  }
  return saida;
}

function achatar(dados: Record<string, unknown>, prefixo = '', saida: Record<string, unknown> = {}): Record<string, unknown> {
  for (const [chave, valor] of Object.entries(dados)) {
    const caminho = `${prefixo}${chave}`;
    if (valor && typeof valor === 'object' && !Array.isArray(valor)) achatar(valor as Record<string, unknown>, `${caminho}.`, saida);
    else saida[caminho] = valor;
  }
  return saida;
}

export function formatarItem(item: Record<string, unknown>): Contexto {
  const saida: Contexto = {};
  for (const [chave, valor] of Object.entries(item)) saida[chave] = formatarValor(chave, valor);
  return { ...saida, ...aliasesContabeis(item) };
}

export function construirContexto(s: Snapshot, textos: Record<string, string>, hoje = new Date()): Contexto {
  const plano = achatar(s as unknown as Record<string, unknown>);
  const c: Contexto = {};
  for (const [chave, valor] of Object.entries(plano)) {
    if (Array.isArray(valor)) continue;
    c[chave] = formatarValor(chave, valor);
  }
  c.data_base = fmtData(s.data_base);
  const [ano, mes, dia] = s.data_base.split('-').map(Number);
  c.data_base_extenso = dataPorExtenso(new Date(ano, mes - 1, dia));
  c.trimestre_maiusculo = s.trimestre.toUpperCase();
  c.data_emissao = fmtData(hoje.toISOString().slice(0, 10));
  c.data_emissao_extenso = dataPorExtenso(hoje);
  c.data_emissao_completa = `${DIAS[hoje.getDay()]}, ${dataPorExtenso(hoje)}`;
  Object.assign(c, aliasesContabeis(plano));
  c['carteira.percentual_pl'] = s.carteira.patrimonio_liquido ? '100,00%' : '0,00%';
  // Garantias ainda não entram no snapshot: saem como n/i (como no Bate Lastro).
  for (const k of ['total', 'verificados', 'pendentes', 'percentual_verificado']) c[`garantias.${k}`] = 'n/i';
  c.nix_garantias_observacao = 'Informações de garantias não disponibilizadas para este relatório (n/i).';
  for (const k of ['total', 'verificados', 'pendentes']) c[`verificacao.total.${k}_contabil`] = 'n/i';
  c['verificacao.total.percentual_verificado'] = 'n/i';
  c['administrador.logo'] = '';
  c['administrador.razao_social'] = s.administrador.razao_social || s.administrador.nome || '';
  for (const frente of ['termo', 'lastro'] as const) {
    c[`anexo_${frente}_situacao`] = s.anexos[frente].length ? '' : s.base_id ? 'Anexo sem dados neste rascunho. Atualize a base do relatório.' : 'Sem registros na amostra.';
  }
  for (const [chave, texto] of Object.entries(textos)) c[chave] = texto ?? '';
  return c;
}

export function listasDoSnapshot(s: Snapshot): Record<string, Contexto[]> {
  const f = (itens: Record<string, unknown>[]) => itens.map(formatarItem);
  return {
    carteira: f(s.carteira.linhas),
    carteira_completa: f(s.carteira.linhas_completas),
    classes: f(s.carteira.classes),
    anexo_termo: s.anexos.termo,
    anexo_lastro: s.anexos.lastro,
    amostra: f(s.amostra.itens),
    blacklist_ocorrencias: f(s.blacklist.itens),
    divergencias_termo: f(s.divergencias.termo),
    divergencias_lastro: f(s.divergencias.lastro),
    verificacao: f([{ frente: 'Lastros', ...s.verificacao.lastro }, { frente: 'Termos de cessão', ...s.verificacao.termo }]),
    garantias: ['Alienação fiduciária', 'Aval', 'Cessão fiduciária'].map((descricao) => ({ descricao, operacoes_contabil: 'n/i', verificados_contabil: 'n/i', pendentes_contabil: 'n/i' })),
    verificacao_ocorrencias: ['Substituídos', 'Vencidos', 'Total'].map((frente) => ({ frente, total_contabil: 'n/i', verificados_contabil: 'n/i', pendentes_contabil: 'n/i' })),
  };
}
