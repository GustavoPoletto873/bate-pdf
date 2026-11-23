import { db } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';
import { criarBase, obterBase } from '@/lib/repo';
import { alertaDaBase, varrerBase, type AlertaBlackList } from '@/lib/blacklist';
import { fundoPorCnpj, obterFundo, type Fundo } from '@/lib/fundos';
import { lerPlanilha, PlanilhaRecusada } from '@/lib/planilha/importar';
import { dataIsoValida, intervaloReferencia, normalizarDataReferencia, rotuloReferencia, type ModoReferencia } from './datas';
import type { ErroValidacao } from './erros';
import { lerTabela } from './planilha';
import { aplicarMapeamento } from './processar';

/**
 * Upload Base no banco local — o que routes/post/relacao_dc.py e routes/get/base_dc.py
 * (verificar_uploads_recentes) fazem no Bate Lastro, gravando com repo.criarBase.
 */

export type UploadsRecentes = {
  tem_uploads_recentes: boolean;
  quantidade_uploads: number;
  ultimo_upload: string | null;
  primeiro_upload: string | null;
  /** Minutos desde o último upload (para "há N minutos"). */
  minutos_desde_ultimo: number | null;
  minutos_intervalo: number;
  data_referencia: string;
};

async function exigirFundo(fundoId: number): Promise<Fundo> {
  const fundo = Number.isInteger(fundoId) ? await obterFundo(fundoId) : null;
  if (!fundo) throw new ErroDeUso('O fundo escolhido não está cadastrado. Atualize a página e escolha o fundo de novo.', 404);
  return fundo;
}

function exigirData(data: string | null | undefined): string {
  if (!dataIsoValida(data)) throw new ErroDeUso('Preencha a data de referência.');
  return data;
}

/**
 * verificar_uploads_recentes: bases do mesmo fundo (pelo cadastro ou pelo CNPJ) com a data de
 * referência no mesmo período, criadas nos últimos `minutos`. Lá contava linhas; aqui, bases.
 */
export async function uploadsRecentes(dados: { fundo_id: number; data_referencia: string; modo: ModoReferencia; minutos?: number; agora?: Date }): Promise<UploadsRecentes> {
  const fundo = await exigirFundo(dados.fundo_id);
  const data = normalizarDataReferencia(exigirData(dados.data_referencia), dados.modo);
  const [inicio, fim] = intervaloReferencia(data, dados.modo);
  const minutos = dados.minutos ?? 30;
  const agora = (dados.agora ?? new Date()).getTime();
  const desde = new Date(agora - minutos * 60_000).toISOString();
  const r = (await (await db()).prepare(`SELECT COUNT(*) n, MAX(criado_em) ultimo, MIN(criado_em) primeiro FROM bases
    WHERE (fundo_id = ? OR cnpj_fundo = ?) AND data_referencia BETWEEN ? AND ? AND criado_em >= ?`)
    .get<{ n: number; ultimo: string | null; primeiro: string | null }>(fundo.id, fundo.cnpj, inicio, fim, desde))!;
  return {
    tem_uploads_recentes: r.n > 0,
    quantidade_uploads: r.n,
    ultimo_upload: r.ultimo,
    primeiro_upload: r.primeiro,
    minutos_desde_ultimo: r.ultimo ? Math.max(0, Math.floor((agora - new Date(r.ultimo).getTime()) / 60_000)) : null,
    minutos_intervalo: minutos,
    data_referencia: data,
  };
}

export type BaseRegistrada = {
  base_id: string;
  nome: string;
  total_registros: number;
  pendentes: { termo: number; lastro: number };
  ja_batidos: number;
  vencimento?: { coluna: string | null; completados: number; por_coluna: Record<string, number> };
  /** Cedentes/sacados da BlackList encontrados na base (vazio = nenhum). */
  blacklist: AlertaBlackList[];
  avisos: string[];
};

export type ResultadoRegistro = { ok: true; base: BaseRegistrada } | { ok: false; erros: ErroValidacao[] };

async function concluir(baseId: string, extra: Partial<BaseRegistrada> = {}): Promise<BaseRegistrada> {
  // BlackList: confere a base recém-gravada na hora, para o aviso sair junto com a conclusão.
  await varrerBase(baseId);
  const blacklist = await alertaDaBase(baseId);
  const base = (await obterBase(baseId))!;
  return {
    base_id: baseId,
    nome: base.nome,
    total_registros: base.titulos,
    pendentes: base.pendentes,
    ja_batidos: base.ja_batidos,
    blacklist,
    avisos: [],
    ...extra,
  };
}

/** "Processar Arquivo": lê a planilha, aplica o mapeamento, valida e cria a base do fundo. */
export async function registrarBase(dados: {
  fundo_id: number;
  data_referencia: string;
  modo: ModoReferencia;
  arquivo: { nome: string; conteudo: Uint8Array };
  mapeamento?: Record<string, string> | null;
}): Promise<ResultadoRegistro> {
  const fundo = await exigirFundo(dados.fundo_id);
  // TRIMESTRE grava o último dia do trimestre; DATA_REFERENCIA, a data informada.
  const data = normalizarDataReferencia(exigirData(dados.data_referencia), dados.modo);
  const tabela = await lerTabela(dados.arquivo.conteudo, dados.arquivo.nome);
  const r = aplicarMapeamento(tabela, dados.mapeamento);
  if (!r.ok) return r;
  const id = await criarBase({
    nome: `${fundo.nome} — ${rotuloReferencia(data, dados.modo)}`,
    nome_fundo: fundo.nome,
    cnpj_fundo: fundo.cnpj,
    data_referencia: data,
    administradora: fundo.administradora_nome,
    origem: 'amostra',
    arquivo_origem: dados.arquivo.nome,
    titulos: r.titulos,
    fundo_id: fundo.id,
    modo_referencia: dados.modo,
  });
  return { ok: true, base: await concluir(id, { vencimento: r.vencimento }) };
}

// ---------------------------------------------------------------------------
// Contingência: resultados_matching_*.xlsx exportado em Resultados do Bate Lastro
// ---------------------------------------------------------------------------

export type PreviaResultados = {
  titulos: number;
  pendentes: { termo: number; lastro: number };
  ja_batidos: number;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  /** Fundo cadastrado com o CNPJ da planilha, se houver. */
  fundo_sugerido: { id: number; nome: string } | null;
  avisos: string[];
};

async function lerResultados(conteudo: Uint8Array, nomeArquivo: string) {
  if (!/\.xlsx$/i.test(nomeArquivo)) throw new PlanilhaRecusada('Envie o resultados_matching_*.xlsx exportado em Resultados do Bate Lastro (arquivo .xlsx).');
  const lido = await lerPlanilha(conteudo, nomeArquivo);
  if (lido.formato !== 'resultados_matching') {
    throw new PlanilhaRecusada('Esta planilha não é um resultados_matching do Bate Lastro (faltam as abas TERMO/LASTRO com ID_BASE e STATUS). Para a amostra do fundo, use a opção "Planilha da base".');
  }
  return lido;
}

export async function previaResultados(conteudo: Uint8Array, nomeArquivo: string): Promise<PreviaResultados> {
  const lido = await lerResultados(conteudo, nomeArquivo);
  const conta = (lado: 'termo' | 'lastro', s: string) => lido.titulos.filter((t) => t.lados[lado] === s).length;
  const fundo = lido.cnpj_fundo ? await fundoPorCnpj(lido.cnpj_fundo) : null;
  return {
    titulos: lido.titulos.length,
    pendentes: { termo: conta('termo', 'pendente'), lastro: conta('lastro', 'pendente') },
    ja_batidos: conta('termo', 'ja_batido') + conta('lastro', 'ja_batido'),
    nome_fundo: lido.nome_fundo,
    cnpj_fundo: lido.cnpj_fundo,
    fundo_sugerido: fundo ? { id: fundo.id, nome: fundo.nome } : null,
    avisos: lido.avisos,
  };
}

/**
 * Cria a base a partir do resultados_matching: os títulos guardam o ID_BASE e o lado que já veio
 * com STATUS V entra como já batido. Fundo e data são opcionais (o CNPJ vem da planilha).
 */
export async function registrarResultados(dados: {
  arquivo: { nome: string; conteudo: Uint8Array };
  fundo_id?: number | null;
  data_referencia?: string | null;
  modo: ModoReferencia;
}): Promise<BaseRegistrada> {
  const lido = await lerResultados(dados.arquivo.conteudo, dados.arquivo.nome);
  const fundo = dados.fundo_id ? await exigirFundo(dados.fundo_id) : (lido.cnpj_fundo ? await fundoPorCnpj(lido.cnpj_fundo) : null);
  const avisos = [...lido.avisos];
  if (fundo && lido.cnpj_fundo && fundo.cnpj !== lido.cnpj_fundo) {
    avisos.push(`O CNPJ da planilha (${lido.cnpj_fundo}) é diferente do CNPJ do fundo escolhido (${fundo.cnpj}). A base ficou com o CNPJ do fundo.`);
  }
  let data: string | null = null;
  if (dados.data_referencia) data = normalizarDataReferencia(exigirData(dados.data_referencia), dados.modo);
  const nomeFundo = fundo?.nome ?? lido.nome_fundo;
  const nome = [nomeFundo ?? dados.arquivo.nome.replace(/\.[^.]+$/, ''), data ? rotuloReferencia(data, dados.modo) : null].filter(Boolean).join(' — ');
  const id = await criarBase({
    nome,
    nome_fundo: nomeFundo,
    cnpj_fundo: fundo?.cnpj ?? lido.cnpj_fundo,
    data_referencia: data,
    administradora: fundo?.administradora_nome ?? null,
    origem: 'resultados_matching',
    arquivo_origem: dados.arquivo.nome,
    titulos: lido.titulos,
    fundo_id: fundo?.id ?? null,
    modo_referencia: dados.modo,
  });
  return await concluir(id, { avisos });
}
