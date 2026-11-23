import { db } from '@/lib/db';
import { listarPendencias, type PendenciaLinha } from '@/lib/repo';
import { resumoParaRelatorio, type ResumoBlackListRelatorio } from '@/lib/blacklist';
import type { CampoId, Lado } from '@/lib/campos';
import { formatarCpfCnpj } from '@/lib/texto';
import { LINHA_VENCIDOS, LINHA_VINCENDOS, LINHAS_CARTEIRA, patrimonioLiquido, totalDireitosCreditorios, type Carteira, type ClasseCota } from './informe';
import { fmtData, fmtMoeda } from './formatos';

/**
 * Snapshot numérico dos relatórios CVM e NIX — porta de services/Relatorios/snapshot_service.py
 * e anexos_service.py do Bate Lastro. Substitui as fórmulas das abas CVM/NIX das geradoras .xlsm.
 */

export const CENARIO_COM_DC = 'COM_DC';
export const CENARIO_SEM_DC = 'SEM_DC';
export const CENARIO_SEM_MOVIMENTACAO = 'SEM_MOVIMENTACAO';
export const CENARIO_SEM_BASE = 'SEM_BASE';
export type Cenario = typeof CENARIO_COM_DC | typeof CENARIO_SEM_DC | typeof CENARIO_SEM_MOVIMENTACAO;

const AMOSTRA_RECOMPRA = 'Recompra';
const AMOSTRA_VINCENDOS = 'Direitos creditórios vincendos';
const AMOSTRA_VENCIDOS = 'Direitos creditórios vencidos';

const CAMPOS_TERMO: Record<string, string> = {
  numero_documento: 'Numero do documento:', nome_cedente: 'Dados do cedente:', nome_sacado: 'Dados do sacado:',
  data_aquisicao: 'Data de aquisição:', valor_nominal: 'Valor Nominal:',
};
const CAMPOS_LASTRO: Record<string, string> = {
  nome_cedente: 'Dados do cedente:', nome_sacado: 'Dados do sacado:', data_vencimento: 'Data de vencimento:',
  data_emissao: 'Data de emissão:', valor_nominal: 'Valor nominal:',
};

/** Colunas do Anexo I (div_*) × campos conferidos aqui. */
const CAMPOS_ANEXO: [string, CampoId][] = [
  ['numero_doc', 'numero_documento'], ['nome_sacado', 'sacado_nome'], ['doc_sacado', 'sacado_documento'],
  ['nome_cedente', 'cedente_nome'], ['doc_cedente', 'cedente_documento'], ['nome_cessionario', 'nome_cessionario'],
  ['doc_cessionario', 'doc_cessionario'], ['valor_nominal', 'valor_total'], ['data_emissao', 'data_emissao'],
  ['data_vencimento', 'data_vencimento'], ['data_aquisicao', 'data_aquisicao'],
];

export type Fundo = {
  id: number; nome: string; cnpj: string; tipo: 'FIDC' | 'FIC_FIDC';
  administrador: { id: number | null; nome: string | null; razao_social: string | null; endereco: string | null; endereco_complemento: string | null };
};

export type LinhaAnexo = Record<string, string>;
export type Verificacao = { total: number; verificados: number; pendentes: number; percentual_verificado: number; divergentes: number };

export type Snapshot = {
  fundo: { id: number; nome: string; cnpj: string; tipo: string };
  administrador: Fundo['administrador'];
  data_base: string;
  trimestre: string;
  trimestre_curto: string;
  amostra_antecipada: boolean;
  cenario: Cenario;
  roteiro_cvm: 'numerado' | 'romano' | null;
  base_id: string | null;
  base_nome: string | null;
  sem_base: boolean;
  carteira: {
    disponivel: boolean;
    linhas: { descricao: string; valor: number; percentual_pl: number }[];
    linhas_completas: { descricao: string; valor: number; percentual_pl: number }[];
    patrimonio_liquido: number;
    conciliacao: { soma_linhas: number; patrimonio_liquido: number; diferenca: number; status: 'OK' | 'VERIFICAR' };
    classes: ClasseCota[];
    vincendos: number;
    vencidos: number;
    total_direitos_creditorios: number;
  };
  amostra: { itens: { descricao: string; quantidade: number; valor: number; percentual_pl: number }[]; total_quantidade: number; total_valor: number; percentual_pl: number };
  verificacao: Record<Lado, Verificacao>;
  divergencias: Record<Lado, { campo: string; quantidade: number }[]>;
  anexos: Record<Lado, LinhaAnexo[]>;
  blacklist: ResumoBlackListRelatorio;
};

export function rotuloTrimestre(dataBase: string): string {
  const [ano, mes] = dataBase.split('-').map(Number);
  return `${Math.floor((mes - 1) / 3) + 1}º Trimestre de ${ano}`;
}
export function trimestreCurto(dataBase: string): string {
  const [ano, mes] = dataBase.split('-').map(Number);
  return `${Math.floor((mes - 1) / 3) + 1}T${ano}`;
}

/** Recompra/substituição vem no tipo; o resto se separa pelo vencimento contra a data-base. */
export function classificarAmostra(tipo: string | null, vencimento: string | null, dataBase: string): string {
  const t = (tipo ?? '').trim().toLowerCase();
  if (t.includes('recompra') || t.includes('substitu')) return AMOSTRA_RECOMPRA;
  if (vencimento && vencimento.slice(0, 10) < dataBase) return AMOSTRA_VENCIDOS;
  return AMOSTRA_VINCENDOS;
}

/** Sem DC na carteira → SEM_DC; DC sem amostra → SEM_MOVIMENTACAO; senão COM_DC. */
export function determinarCenario(carteira: Carteira | null, totalAmostra: number): Cenario {
  if (!carteira || totalDireitosCreditorios(carteira) === 0) return CENARIO_SEM_DC;
  if (totalAmostra === 0) return CENARIO_SEM_MOVIMENTACAO;
  return CENARIO_COM_DC;
}

const soDigitos = (v: unknown) => String(v ?? '').replace(/\D/g, '');

/** Veredito automático quando não há decisão gravada (comparar_campo do Bate Lastro, simplificado). */
function compararCampo(base: string | null, leitura: string | null | undefined, campo: string): 'V' | 'D' | 'P' {
  if (leitura === null || leitura === undefined || String(leitura).trim() === '') return 'P';
  if (campo === 'numero_doc' || campo === 'doc_cessionario' || campo.startsWith('doc_')) {
    return soDigitos(base).replace(/^0+/, '') === soDigitos(leitura).replace(/^0+/, '') ? 'V' : 'D';
  }
  if (campo.startsWith('data_')) return fmtData(base) === fmtData(leitura) ? 'V' : 'D';
  if (campo === 'valor_nominal') return Math.abs(Number(base ?? 0) - Number(leitura)) < 0.005 ? 'V' : 'D';
  return String(base ?? '').trim().toUpperCase() === String(leitura).trim().toUpperCase() ? 'V' : 'D';
}

/** Quadros do Anexo I: toda a amostra, com o que foi batido aqui (e o que veio batido do Bate Lastro). */
export async function montarAnexos(baseId: string | null): Promise<Record<Lado, LinhaAnexo[]>> {
  if (!baseId) return { termo: [], lastro: [] };
  const c = await db();
  const pendencias = await listarPendencias(baseId);
  const porTitulo = new Map<number, Partial<Record<Lado, PendenciaLinha>>>();
  const titulos: PendenciaLinha['titulo'][] = [];
  for (const p of pendencias) {
    if (!porTitulo.has(p.titulo_id)) { porTitulo.set(p.titulo_id, {}); titulos.push(p.titulo); }
    porTitulo.get(p.titulo_id)![p.lado] = p;
  }
  // Títulos sem nenhuma pendência (raro) também entram na amostra.
  const semPendencia = await c.prepare(`SELECT t.* FROM titulos t WHERE t.base_id = ? AND NOT EXISTS (SELECT 1 FROM pendencias p WHERE p.titulo_id = t.id) ORDER BY t.id`).all<PendenciaLinha['titulo']>(baseId);
  titulos.push(...semPendencia);
  titulos.sort((a, b) => a.id - b.id);
  const notas = new Map((await c.prepare('SELECT chave_nfe, status_nfe FROM notas_fiscais WHERE base_id = ?').all<{ chave_nfe: string; status_nfe: string }>(baseId)).map((n) => [n.chave_nfe, n.status_nfe]));

  const anexos: Record<Lado, LinhaAnexo[]> = { termo: [], lastro: [] };
  for (const t of titulos) {
    const dadosBase: Record<string, string> = {
      base_numero_doc: t.numero_documento ?? '', base_nome_sacado: t.sacado_nome ?? '', base_doc_sacado: t.sacado_documento ?? '',
      base_nome_cedente: t.cedente_nome ?? '', base_doc_cedente: t.cedente_documento ?? '', base_nome_fundo: t.nome_fundo ?? '',
      base_cnpj_fundo: t.cnpj_fundo ?? '', base_valor_nominal: t.valor_total != null ? fmtMoeda(Number(t.valor_total)) : '',
      base_data_vencimento: fmtData(t.data_vencimento), base_data_aquisicao: fmtData(t.data_aquisicao), base_data_emissao: fmtData(t.data_emissao),
      base_chave_nfe: t.chave_nfe ?? '', base_tipo_recebivel: t.tipo_recebivel ?? '',
    };
    const valorBase: Record<CampoId, string | null> = {
      numero_documento: t.numero_documento, sacado_nome: t.sacado_nome, sacado_documento: t.sacado_documento, cedente_nome: t.cedente_nome,
      cedente_documento: t.cedente_documento, nome_cessionario: t.nome_fundo, doc_cessionario: t.cnpj_fundo, valor_total: t.valor_total,
      data_emissao: t.data_emissao, data_vencimento: t.data_vencimento, data_aquisicao: t.data_aquisicao,
    };
    for (const frente of ['termo', 'lastro'] as const) {
      const p = porTitulo.get(t.id)?.[frente];
      const batido = p && p.situacao !== 'pendente';
      const linha: LinhaAnexo = { status: batido ? 'V' : 'P', ...dadosBase };
      for (const [col, campo] of CAMPOS_ANEXO) {
        let v: string = 'P';
        if (p?.situacao === 'ja_batido') v = 'V'; // batido no Bate Lastro: as decisões estão lá
        else if (p?.situacao === 'vinculado' && p.vinculo) {
          v = p.vinculo.marcacoes[campo] ?? compararCampo(valorBase[campo], p.vinculo.leitura[campo], col);
        }
        linha[`div_${col}`] = v;
      }
      linha.status_n = notas.get(soDigitos(t.chave_nfe)) ?? 'N/A';
      anexos[frente].push(linha);
    }
  }
  return anexos;
}

const GRUPOS: Record<string, string[]> = {
  numero_documento: ['numero_doc'], nome_cedente: ['nome_cedente', 'doc_cedente'], nome_sacado: ['nome_sacado', 'doc_sacado'],
};

/** Resumo de verificação e divergências a partir das mesmas linhas do Anexo I. */
function resumir(anexos: Record<Lado, LinhaAnexo[]>) {
  const verificacao = {} as Record<Lado, Verificacao>;
  const divergencias = {} as Record<Lado, { campo: string; quantidade: number }[]>;
  for (const [frente, campos] of [['termo', CAMPOS_TERMO], ['lastro', CAMPOS_LASTRO]] as const) {
    const linhas = anexos[frente];
    const total = linhas.length;
    const verificados = linhas.filter((l) => l.status === 'V').length;
    verificacao[frente] = {
      total, verificados, pendentes: total - verificados, percentual_verificado: total ? verificados / total : 0,
      divergentes: linhas.filter((l) => CAMPOS_ANEXO.some(([c]) => l[`div_${c}`] === 'D')).length,
    };
    divergencias[frente] = Object.entries(campos).map(([campo, rotulo]) => ({
      campo: rotulo,
      quantidade: linhas.filter((l) => (GRUPOS[campo] ?? [campo]).some((c) => l[`div_${c}`] === 'D')).length,
    }));
  }
  return { verificacao, divergencias };
}

async function amostraDaBase(baseId: string | null, dataBase: string, pl: number) {
  const grupos: Record<string, { quantidade: number; valor: number }> = {
    [AMOSTRA_RECOMPRA]: { quantidade: 0, valor: 0 }, [AMOSTRA_VINCENDOS]: { quantidade: 0, valor: 0 }, [AMOSTRA_VENCIDOS]: { quantidade: 0, valor: 0 },
  };
  if (baseId) {
    for (const t of await (await db()).prepare('SELECT tipo_recebivel, data_vencimento, valor_total FROM titulos WHERE base_id = ?').all<{ tipo_recebivel: string | null; data_vencimento: string | null; valor_total: string | null }>(baseId)) {
      const g = grupos[classificarAmostra(t.tipo_recebivel, t.data_vencimento, dataBase)];
      g.quantidade++;
      g.valor += Number(t.valor_total ?? 0) || 0;
    }
  }
  const itens = Object.entries(grupos).map(([descricao, d]) => ({ descricao, ...d, percentual_pl: pl ? d.valor / pl : 0 }));
  const totalQ = itens.reduce((s, i) => s + i.quantidade, 0);
  const totalV = itens.reduce((s, i) => s + i.valor, 0);
  return { itens, total_quantidade: totalQ, total_valor: totalV, percentual_pl: pl ? totalV / pl : 0 };
}

export async function montarSnapshot(fundo: Fundo, carteira: Carteira | null, dataBase: string, base: { id: string; nome: string } | null, antecipada: boolean): Promise<Snapshot> {
  const pl = carteira ? patrimonioLiquido(carteira) : 0;
  const completas = carteira ? LINHAS_CARTEIRA.map((descricao) => {
    const valor = carteira.linhas[descricao] ?? 0;
    return { descricao, valor, percentual_pl: pl ? valor / pl : 0 };
  }) : [];
  const soma = completas.reduce((s, l) => s + l.valor, 0);
  const amostra = await amostraDaBase(base?.id ?? null, dataBase, pl);
  const anexos = await montarAnexos(base?.id ?? null);
  const blacklist = await resumoParaRelatorio(base?.id ?? null);
  const { verificacao, divergencias } = resumir(anexos);
  return {
    fundo: { id: fundo.id, nome: fundo.nome, cnpj: formatarCpfCnpj(fundo.cnpj), tipo: fundo.tipo === 'FIC_FIDC' ? 'FIC FIDC' : 'FIDC' },
    administrador: fundo.administrador,
    data_base: dataBase,
    trimestre: rotuloTrimestre(dataBase),
    trimestre_curto: trimestreCurto(dataBase),
    amostra_antecipada: antecipada,
    cenario: determinarCenario(carteira, amostra.total_quantidade),
    roteiro_cvm: null,
    base_id: base?.id ?? null,
    base_nome: base?.nome ?? null,
    sem_base: !base,
    carteira: {
      disponivel: Boolean(carteira),
      linhas: completas.filter((l) => l.valor !== 0),
      linhas_completas: completas,
      patrimonio_liquido: pl,
      conciliacao: { soma_linhas: soma, patrimonio_liquido: pl, diferenca: soma - pl, status: Math.round(soma - pl) === 0 ? 'OK' : 'VERIFICAR' },
      classes: carteira?.classes ?? [],
      vincendos: carteira?.linhas[LINHA_VINCENDOS] ?? 0,
      vencidos: carteira?.linhas[LINHA_VENCIDOS] ?? 0,
      total_direitos_creditorios: carteira ? totalDireitosCreditorios(carteira) : 0,
    },
    amostra,
    verificacao,
    divergencias,
    anexos,
    blacklist,
  };
}

/** CVM "sem pendências": pendentes contam como verificados (o total não muda); divergências continuam. */
export function semPendencias(s: Snapshot): Snapshot {
  const verificacao = Object.fromEntries(Object.entries(s.verificacao).map(([f, v]) => [f, { ...v, verificados: v.total, pendentes: 0, percentual_verificado: v.total ? 1 : 0 }])) as Snapshot['verificacao'];
  const anexos = Object.fromEntries(Object.entries(s.anexos).map(([f, linhas]) => [f, linhas.map((l) =>
    Object.fromEntries(Object.entries(l).map(([k, v]) => [k, (k === 'status' || k.startsWith('div_')) && v === 'P' ? 'V' : v])))])) as Snapshot['anexos'];
  return { ...s, verificacao, anexos };
}
