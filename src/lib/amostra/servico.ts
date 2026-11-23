import { apagarPasta, gravarArquivo, lerArquivo } from '@/lib/arquivos';
import { db, emBlocos, inserirVarios, transacao, type Banco } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';
import { digitos } from '@/lib/texto';
import {
  ErroAmostragem, gerarSeed, normalizarSeed, REGRA_PADRAO, REGRA_PLANNER, sha256, type Regra,
} from './selecao';
import { dataBase as dataBaseDoQuadro, lerPlanilha, normalizarColunas, type Arquivo } from './leitura';
import { texto as textoPandas, linhasDoExcel, decodificarLatin1, tokenizarCsv } from './pandas';
import {
  consolidar, excelDaAmostra, gerarAmostra, montarPacote, refazerAmostra, totalDeTitulos, type Manifesto,
} from './motor';
import { inicioTrimestre, pendenciasEmAberto, type LinhaBaseAnterior, type Pendencias } from './consolidado';

/**
 * Gestão › Amostra — porta de backend/services/Amostragem/amostragem_service.py: geração, histórico,
 * descarte, download e conferência das amostras. No lugar do S3, os arquivos ficam em
 * <dados>/amostragens/<id>/ (insumos, manifesto.json, populacao.csv e amostra.xlsx). Um usuário só:
 * sem instituição, grupos nem papéis.
 */

const agora = () => new Date().toISOString();

export type FundoAmostra = { id: number; nome: string; cnpj: string; administradora_id: number | null; administradora: string | null };

export type ResumoAmostragem = {
  id: number;
  fundo_id: number;
  fundo: string | null;
  cnpj_fundo: string | null;
  seed: string;
  versao: string;
  regra: Regra;
  data_de: string;
  data_ate: string;
  limite_adquiridos: number;
  limite_vencidos: number;
  total_titulos: number;
  populacao_titulos: number;
  contagem: Record<string, number>;
  avisos: string[];
  status: 'GERADA' | 'DESCARTADA';
  motivo_descarte: string | null;
  descartada_em: string | null;
  amostra_anterior_id: number | null;
  criado_em: string;
};

export type InsumoAmostragem = { tipo: string; ordem: number; nome_arquivo: string; sha256: string; tamanho: number };

type LinhaAmostragem = Omit<ResumoAmostragem, 'contagem' | 'avisos'> & {
  contagem: string | null; avisos: string | null; manifesto: string; populacao_sha256: string | null;
};

const SQL_AMOSTRAGEM = `
  SELECT a.*, f.nome AS fundo, f.cnpj AS cnpj_fundo FROM amostragens a LEFT JOIN fundos f ON f.id = a.fundo_id`;

/** Prefixo (no armazenamento) dos arquivos da amostragem. */
function pastaDaAmostra(id: number) {
  return `amostragens/${id}`;
}

/** Converte erro do motor em erro de tela. */
async function semErroDoMotor<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErroAmostragem) throw new ErroDeUso(e.message, e.status);
    throw e;
  }
}

function resumo(l: LinhaAmostragem): ResumoAmostragem {
  return {
    id: l.id, fundo_id: l.fundo_id, fundo: l.fundo, cnpj_fundo: l.cnpj_fundo, seed: l.seed, versao: l.versao, regra: l.regra,
    data_de: l.data_de, data_ate: l.data_ate, limite_adquiridos: l.limite_adquiridos, limite_vencidos: l.limite_vencidos,
    total_titulos: l.total_titulos ?? 0, populacao_titulos: l.populacao_titulos ?? 0,
    contagem: l.contagem ? JSON.parse(l.contagem) : {}, avisos: l.avisos ? JSON.parse(l.avisos) : [],
    status: l.status, motivo_descarte: l.motivo_descarte, descartada_em: l.descartada_em,
    amostra_anterior_id: l.amostra_anterior_id, criado_em: l.criado_em,
  };
}

async function linhaDaAmostragem(id: number): Promise<LinhaAmostragem> {
  if (!Number.isInteger(id) || id <= 0) throw new ErroDeUso('Amostra não encontrada.', 404);
  const l = await (await db()).prepare(`${SQL_AMOSTRAGEM} WHERE a.id = ?`).get<LinhaAmostragem>(id);
  if (!l) throw new ErroDeUso('Amostra não encontrada.', 404);
  return l;
}

async function insumos(id: number): Promise<(InsumoAmostragem & { arquivo: string })[]> {
  return (await db()).prepare('SELECT tipo, ordem, nome_arquivo, sha256, tamanho, arquivo FROM amostragem_insumos WHERE amostragem_id = ? ORDER BY tipo, ordem')
    .all<InsumoAmostragem & { arquivo: string }>(id);
}

async function arquivosDoTipo(id: number, tipo: string): Promise<Arquivo[]> {
  return Promise.all((await insumos(id)).filter((i) => i.tipo === tipo).map(async (i) => {
    const conteudo = await lerArquivo(`${pastaDaAmostra(id)}/${i.arquivo}`);
    if (!conteudo) throw new ErroDeUso(`O arquivo ${i.nome_arquivo} desta amostra não está mais no armazenamento do Lastro.`, 404);
    return { nome: i.nome_arquivo, conteudo };
  }));
}

// ---------------------------------------------------------------------------
// Fundos
// ---------------------------------------------------------------------------

export async function listarFundos(): Promise<FundoAmostra[]> {
  return (await db()).prepare(`
    SELECT f.id, f.nome, f.cnpj, f.administradora_id, a.nome AS administradora
      FROM fundos f LEFT JOIN administradoras a ON a.id = f.administradora_id
     ORDER BY f.nome COLLATE NOCASE`).all<FundoAmostra>();
}

async function fundo(id: number): Promise<FundoAmostra> {
  const f = (await listarFundos()).find((x) => x.id === id);
  if (!f) throw new ErroDeUso('Fundo não encontrado. Cadastre o fundo em Gestão › Fundos.', 404);
  return f;
}

// ---------------------------------------------------------------------------
// Pendências dos bates anteriores (regra Planner)
// ---------------------------------------------------------------------------

/**
 * Títulos das bases do fundo anteriores ao trimestre, com o que ficou pendente em cada lado. Lado
 * atendido = vínculo, pré-bate ou já batido no Bate Lastro; lado sem pendência (não conferido na
 * base) conta como atendido. "Base teve bate" = algum lado atendido na base.
 */
export async function linhasDosBatesAnteriores(f: Pick<FundoAmostra, 'id' | 'cnpj'>, inicio: string): Promise<LinhaBaseAnterior[]> {
  const c = await db();
  const bases = (await c.prepare('SELECT id, fundo_id, cnpj_fundo, data_referencia, criado_em FROM bases WHERE data_referencia IS NOT NULL AND data_referencia < ?')
    .all<{ id: string; fundo_id: number | null; cnpj_fundo: string | null; data_referencia: string; criado_em: string }>(inicio))
    .filter((b) => b.fundo_id === f.id || (!!b.cnpj_fundo && digitos(b.cnpj_fundo) === f.cnpj));
  const linhas: LinhaBaseAnterior[] = [];
  // Títulos e "teve bate" de todas as bases em poucas consultas (não duas por base).
  const titulosPorBase = new Map<string, Record<string, string | number | null>[]>();
  const teveBate = new Set<string>();
  for (const bloco of emBlocos(bases.map((b) => b.id))) {
    const m = bloco.map(() => '?').join(',');
    for (const t of await c.prepare(`
    SELECT t.id, t.base_id, t.nome_fundo, t.cedente_nome, t.cedente_documento, t.sacado_nome, t.sacado_documento, t.numero_documento,
           t.tipo_recebivel, t.valor_total, t.valor_aquisicao, t.data_vencimento, t.data_emissao, t.data_aquisicao, t.chave_nfe,
           EXISTS (SELECT 1 FROM pendencias p WHERE p.titulo_id = t.id AND p.lado = 'lastro' AND p.situacao = 'pendente'
                    AND NOT EXISTS (SELECT 1 FROM pre_matches pm WHERE pm.pendencia_id = p.id)) AS pend_lastro,
           EXISTS (SELECT 1 FROM pendencias p WHERE p.titulo_id = t.id AND p.lado = 'termo' AND p.situacao = 'pendente'
                    AND NOT EXISTS (SELECT 1 FROM pre_matches pm WHERE pm.pendencia_id = p.id)) AS pend_termo
      FROM titulos t WHERE t.base_id IN (${m}) ORDER BY t.id`).all<Record<string, string | number | null>>(...bloco)) {
      const id = String(t.base_id);
      titulosPorBase.set(id, [...(titulosPorBase.get(id) ?? []), t]);
    }
    for (const r of await c.prepare(`SELECT DISTINCT base_id FROM pendencias WHERE base_id IN (${m}) AND situacao IN ('vinculado','ja_batido')
      UNION SELECT DISTINCT base_id FROM pre_matches WHERE base_id IN (${m})`).all<{ base_id: string }>(...bloco, ...bloco)) teveBate.add(r.base_id);
  }
  for (const b of bases) {
    const teve = teveBate.has(b.id);
    for (const t of titulosPorBase.get(b.id) ?? []) {
      linhas.push({
        id: Number(t.id), BASE_ID: b.id, DATA_REFERENCIA: b.data_referencia.slice(0, 10), DATA_CRIACAO: b.criado_em,
        NOME_FUNDO: t.nome_fundo as string | null, NOME_CEDENTE: t.cedente_nome as string | null,
        DOC_CEDENTE: t.cedente_documento as string | null, NOME_SACADO: t.sacado_nome as string | null,
        DOC_SACADO: t.sacado_documento as string | null, NU_DOCUMENTO: t.numero_documento as string | null,
        TIPO_RECEBIVEL: t.tipo_recebivel as string | null, VALOR_NOMINAL: t.valor_total as string | null,
        VALOR_AQUISICAO: t.valor_aquisicao as string | null, DATA_VENCIMENTO_ORIGINAL: t.data_vencimento as string | null,
        DATA_EMISSAO: t.data_emissao as string | null, DATA_AQUISICAO: t.data_aquisicao as string | null,
        CHAVE_NFE: t.chave_nfe as string | null,
        lastro: !t.pend_lastro, termo: !t.pend_termo, base_teve_bate: teve,
      });
    }
  }
  return linhas;
}

export async function pendenciasPlanner(f: FundoAmostra, dataAte: string): Promise<Pendencias> {
  const trimestre = inicioTrimestre(dataAte);
  return pendenciasEmAberto(await linhasDosBatesAnteriores(f, trimestre), trimestre);
}

// ---------------------------------------------------------------------------
// Geração
// ---------------------------------------------------------------------------

type Conflitante = { id: number; seed: string; data_de: string; data_ate: string };

async function conflitantes(c: Banco, fundoId: number, de: string, ate: string, populacaoSha: string, estoquesSha: string[]): Promise<Conflitante[]> {
  const marcas = estoquesSha.map(() => '?').join(',') || "''";
  return c.prepare(`
    SELECT a.id, a.seed, a.data_de, a.data_ate FROM amostragens a
     WHERE a.fundo_id = ? AND a.status = 'GERADA' AND a.data_de <= ? AND a.data_ate >= ?
       AND ((a.data_de = ? AND a.data_ate = ?) OR a.populacao_sha256 = ?
            OR EXISTS (SELECT 1 FROM amostragem_insumos i WHERE i.amostragem_id = a.id AND i.tipo = 'ESTOQUE' AND i.sha256 IN (${marcas})))
     ORDER BY a.criado_em`).all<Conflitante>(fundoId, ate, de, de, ate, populacaoSha, ...estoquesSha);
}

const br = (iso: string) => iso.split('-').reverse().join('/');

async function exigirMotivoSeConflita(c: Banco, fundoId: number, de: string, ate: string, popSha: string, estoquesSha: string[], motivo: string) {
  const lista = await conflitantes(c, fundoId, de, ate, popSha, estoquesSha);
  if (lista.length && !motivo) {
    throw new ErroDeUso(
      `Este fundo já tem amostra valendo com o mesmo estoque e período que se sobrepõe: ${lista.map((c) => `${br(c.data_de)} a ${br(c.data_ate)} (seed ${c.seed})`).join('; ')}. Para sortear de novo, informe o motivo: ela fica registrada como descartada.`,
      409,
    );
  }
  return lista;
}

export type PedidoAmostra = {
  fundoId: number;
  dataDe: string;
  dataAte: string;
  limiteAdquiridos: number;
  limiteVencidos: number;
  regra: Regra;
  estoques: Arquivo[];
  liquidados?: Arquivo[];
  amostraAnterior?: Arquivo | null;
  amostraAnteriorId?: number | null;
  motivo?: string | null;
};

const extensao = (nome: string) => (nome.includes('.') ? nome.split('.').pop()!.toLowerCase() : 'bin');

/** Sorteia, guarda os arquivos e registra a amostra; devolve o resumo. */
export async function gerar(p: PedidoAmostra, seed: string = gerarSeed()): Promise<DetalheAmostragem> {
  const f = await fundo(p.fundoId);
  if (p.amostraAnterior && p.amostraAnteriorId) throw new ErroDeUso('Escolha a amostra anterior do histórico ou envie o arquivo, não os dois.');
  const motivo = (p.motivo ?? '').trim();
  let chavesAnteriores: string[] | null = null;
  let anterior: LinhaAmostragem | null = null;
  if (p.amostraAnteriorId) {
    anterior = await linhaDaAmostragem(p.amostraAnteriorId);
    if (anterior.fundo_id !== p.fundoId) throw new ErroDeUso('A amostra anterior escolhida é de outro fundo.');
    if (anterior.status !== 'GERADA' || anterior.data_ate >= p.dataDe) throw new ErroDeUso('A amostra anterior precisa estar valendo e terminar antes do início do período.');
    chavesAnteriores = (JSON.parse(anterior.manifesto) as Manifesto).selecao.map((s) => s.chave);
  }
  const pendencias = p.regra === REGRA_PLANNER ? await pendenciasPlanner(f, p.dataAte) : null;
  const liquidados = p.liquidados ?? [];

  const r = await semErroDoMotor(() => gerarAmostra({
    estoques: p.estoques, dataDe: p.dataDe, dataAte: p.dataAte, limiteAdquiridos: p.limiteAdquiridos, limiteVencidos: p.limiteVencidos,
    seed, amostraAnterior: p.amostraAnterior, nomeFundo: f.nome, regra: p.regra, chavesAnteriores, liquidados,
  }));
  if (pendencias) consolidar(r, pendencias, f.nome);
  if (anterior) r.manifesto.amostra_anterior = { amostragem_id: anterior.id, seed: anterior.seed };

  const estoquesSha = p.estoques.map((a) => sha256(a.conteudo));
  const popSha = r.manifesto.populacao.sha256;
  await exigirMotivoSeConflita(await db(), p.fundoId, p.dataDe, p.dataAte, popSha, estoquesSha, motivo);
  const xlsx = await excelDaAmostra(r);
  const m = r.manifesto;

  const registros: { tipo: string; ordem: number; arquivo: Arquivo }[] = [
    ...p.estoques.map((arquivo, ordem) => ({ tipo: 'ESTOQUE', ordem, arquivo })),
    ...(p.amostraAnterior ? [{ tipo: 'AMOSTRA_ANTERIOR', ordem: 0, arquivo: p.amostraAnterior }] : []),
    ...(m.liquidados ? liquidados.map((arquivo, ordem) => ({ tipo: 'LIQUIDADOS', ordem, arquivo })) : []),
  ];

  let id = 0;
  try {
    await transacao(async (tx) => {
      const lista = await exigirMotivoSeConflita(tx, p.fundoId, p.dataDe, p.dataAte, popSha, estoquesSha, motivo);
      const ts = agora();
      await tx.lote(lista.map((c) => ({
        sql: "UPDATE amostragens SET status = 'DESCARTADA', motivo_descarte = ?, descartada_em = ? WHERE id = ? AND status = 'GERADA'",
        args: [`Substituída por nova amostra: ${motivo}`, ts, c.id],
      })));
      const ins = await tx.prepare(`
        INSERT INTO amostragens (fundo_id, versao, seed, regra, data_de, data_ate, limite_adquiridos, limite_vencidos,
          amostra_anterior_id, populacao_sha256, populacao_titulos, total_titulos, contagem, avisos, manifesto, status, criado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'GERADA', ?)`).run(
        p.fundoId, m.versao, m.seed, p.regra, p.dataDe, p.dataAte, p.limiteAdquiridos, p.limiteVencidos,
        anterior?.id ?? null, popSha, m.populacao.titulos, totalDeTitulos(r), JSON.stringify(m.contagem),
        JSON.stringify(r.avisos), JSON.stringify(m), ts);
      id = Number(ins.lastInsertRowid);
      const pasta = pastaDaAmostra(id);
      const linhasInsumo: (string | number)[][] = [];
      for (const reg of registros) {
        const sha = sha256(reg.arquivo.conteudo);
        const relativo = `insumos/${sha}.${extensao(reg.arquivo.nome)}`;
        await gravarArquivo(`${pasta}/${relativo}`, reg.arquivo.conteudo);
        linhasInsumo.push([id, reg.tipo, reg.ordem, reg.arquivo.nome, sha, reg.arquivo.conteudo.byteLength, relativo]);
      }
      await inserirVarios(tx, 'amostragem_insumos', ['amostragem_id', 'tipo', 'ordem', 'nome_arquivo', 'sha256', 'tamanho', 'arquivo'], linhasInsumo);
      await Promise.all([
        gravarArquivo(`${pasta}/manifesto.json`, new TextEncoder().encode(JSON.stringify(m, null, 2)), 'application/json'),
        gravarArquivo(`${pasta}/populacao.csv`, r.populacaoCsv, 'text/csv'),
        r.liquidadosCsv.byteLength ? gravarArquivo(`${pasta}/liquidados.csv`, r.liquidadosCsv, 'text/csv') : null,
        gravarArquivo(`${pasta}/amostra.xlsx`, xlsx),
      ]);
    });
  } catch (e) {
    if (id) await apagarPasta(pastaDaAmostra(id)).catch(() => undefined);
    throw e;
  }
  return obter(id);
}

// ---------------------------------------------------------------------------
// Consulta, descarte e arquivos
// ---------------------------------------------------------------------------

export async function listar(fundoId?: number | null, limite = 50): Promise<ResumoAmostragem[]> {
  const c = await db();
  const linhas = fundoId
    ? await c.prepare(`${SQL_AMOSTRAGEM} WHERE a.fundo_id = ? ORDER BY a.criado_em DESC, a.id DESC LIMIT ?`).all(fundoId, limite)
    : await c.prepare(`${SQL_AMOSTRAGEM} ORDER BY a.criado_em DESC, a.id DESC LIMIT ?`).all(limite);
  return (linhas as LinhaAmostragem[]).map(resumo);
}

export type DetalheAmostragem = ResumoAmostragem & { populacao_sha256: string | null; insumos: InsumoAmostragem[] };

export async function obter(id: number): Promise<DetalheAmostragem> {
  const l = await linhaDaAmostragem(id);
  return {
    ...resumo(l), populacao_sha256: l.populacao_sha256,
    insumos: (await insumos(id)).map(({ tipo, ordem, nome_arquivo, sha256: sha, tamanho }) => ({ tipo, ordem, nome_arquivo, sha256: sha, tamanho })),
  };
}

export async function descartar(id: number, motivoInformado: string): Promise<DetalheAmostragem> {
  const l = await linhaDaAmostragem(id);
  const motivo = (motivoInformado ?? '').trim();
  if (!motivo) throw new ErroDeUso('Informe o motivo do descarte: ele fica registrado no histórico.');
  if (l.status !== 'GERADA') throw new ErroDeUso('Esta amostra já foi descartada.', 409);
  await (await db()).prepare("UPDATE amostragens SET status = 'DESCARTADA', motivo_descarte = ?, descartada_em = ? WHERE id = ? AND status = 'GERADA'")
    .run(motivo, agora(), id);
  return obter(id);
}

function nomeBase(l: LinhaAmostragem): string {
  const cnpj = digitos(l.cnpj_fundo ?? '');
  const nome = (l.fundo ?? '').normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
  return `Amostra_${cnpj}_${nome}_${l.data_ate.replace(/-/g, '')}`;
}

export const TIPOS_ARQUIVO = {
  amostra: { sufixo: '', extensao: '.xlsx', mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  pacote: { sufixo: '_com_estoque', extensao: '.zip', mime: 'application/zip' },
} as const;

export async function arquivo(id: number, tipo: string): Promise<{ nome: string; conteudo: Uint8Array; mime: string }> {
  if (tipo !== 'amostra' && tipo !== 'pacote') throw new ErroDeUso('Arquivo desconhecido.', 404);
  const l = await linhaDaAmostragem(id);
  let conteudo = await lerArquivo(`${pastaDaAmostra(id)}/amostra.xlsx`);
  if (!conteudo) throw new ErroDeUso('O arquivo desta amostra não está mais no armazenamento do Lastro.', 404);
  if (tipo === 'pacote') conteudo = await montarPacote(conteudo, await arquivosDoTipo(id, 'ESTOQUE'), await arquivosDoTipo(id, 'LIQUIDADOS'));
  const t = TIPOS_ARQUIVO[tipo];
  return { nome: `${nomeBase(l)}${t.sufixo}${t.extensao}`, conteudo, mime: t.mime };
}

/** Refaz com os estoques guardados e compara com a registrada. */
export async function verificar(id: number): Promise<{ identica: boolean; divergencias: string[] }> {
  const l = await linhaDaAmostragem(id);
  try {
    const [, divergencias] = await refazerAmostra(await arquivosDoTipo(id, 'ESTOQUE'), JSON.parse(l.manifesto), l.fundo ?? '', await arquivosDoTipo(id, 'LIQUIDADOS'));
    return { identica: !divergencias.length, divergencias: divergencias.slice(0, 50) };
  } catch (e) {
    if (e instanceof ErroAmostragem) return { identica: false, divergencias: [e.message] };
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { identica: false, divergencias: ['Os estoques guardados desta amostra não estão mais na pasta de dados do Lastro.'] };
    throw e;
  }
}

function seedValida(seed: string): string {
  try {
    return normalizarSeed(seed);
  } catch (e) {
    if (e instanceof ErroAmostragem) throw new ErroDeUso(e.message);
    throw e;
  }
}

async function porSeed(seed: string): Promise<LinhaAmostragem | null> {
  const r = await (await db()).prepare('SELECT id FROM amostragens WHERE seed = ? ORDER BY criado_em, id LIMIT 1').get<{ id: number }>(seed);
  return r ? linhaDaAmostragem(r.id) : null;
}

export async function buscarPorSeed(seed: string): Promise<DetalheAmostragem> {
  const l = await porSeed(seedValida(seed));
  if (!l) throw new ErroDeUso('Nenhuma amostra registrada com esta seed.', 404);
  return obter(l.id);
}

export type TituloConferido = { grupo: string; cedente: string; doc_cedente: string; nu_documento: string; seu_numero: string; valor_presente: number };

function titulosDe(amostra: Record<string, string | number | null>[]): TituloConferido[] {
  return amostra.map((t) => ({
    grupo: String(t.RELATORIO), cedente: String(t.NOME_CEDENTE), doc_cedente: String(t.DOC_CEDENTE),
    nu_documento: String(t.NU_DOCUMENTO), seu_numero: String(t.SEU_NUMERO), valor_presente: Number(t.VALOR_PRESENTE),
  }));
}

export type Conferencia = {
  registrada: DetalheAmostragem | null;
  confere: boolean | null;
  divergencias: string[];
  contagem: Record<string, number>;
  titulos: TituloConferido[];
};

/** Refaz a amostra de uma seed com o estoque enviado, sem registrar nada. */
export async function conferir(seedInformada: string, estoques: Arquivo[], opcoes: {
  dataDe?: string | null; dataAte?: string | null; limiteAdquiridos?: number | null; limiteVencidos?: number | null;
  regra?: Regra; amostraAnterior?: Arquivo | null; liquidados?: Arquivo[];
}): Promise<Conferencia> {
  const seed = seedValida(seedInformada);
  if (!estoques.length) throw new ErroDeUso('Envie o estoque usado na amostra.');
  const l = await porSeed(seed);
  if (l) {
    const registrada = await obter(l.id);
    try {
      const [r, divergencias] = await refazerAmostra(estoques, JSON.parse(l.manifesto), l.fundo ?? '', opcoes.liquidados ?? []);
      return { registrada, confere: !divergencias.length, divergencias: divergencias.slice(0, 50), contagem: r.manifesto.contagem, titulos: titulosDe(r.amostra) };
    } catch (e) {
      if (e instanceof ErroAmostragem) return { registrada, confere: false, divergencias: [e.message], contagem: {}, titulos: [] };
      throw e;
    }
  }
  const { dataDe, dataAte, limiteAdquiridos, limiteVencidos } = opcoes;
  if (!dataDe || !dataAte || limiteAdquiridos == null || limiteVencidos == null) {
    throw new ErroDeUso('Esta seed não é de nenhuma amostra registrada no Lastro. Para ver a amostra que ela gera com este estoque, informe o período e os limites.');
  }
  const r = await semErroDoMotor(() => gerarAmostra({
    estoques, dataDe, dataAte, limiteAdquiridos, limiteVencidos, seed, amostraAnterior: opcoes.amostraAnterior,
    regra: opcoes.regra ?? REGRA_PADRAO, liquidados: opcoes.liquidados ?? [],
  }));
  return { registrada: null, confere: null, divergencias: [], contagem: r.manifesto.contagem, titulos: titulosDe(r.amostra) };
}

// ---------------------------------------------------------------------------
// Inspeção dos arquivos (data-base do estoque e fundo escrito no arquivo)
// ---------------------------------------------------------------------------

const COLUNAS_NOME = ['NOME_FUNDO', 'FUNDO', 'Fundo', 'Nome Fundo', 'Nome Originador'];
const COLUNAS_CNPJ = ['DOC_FUNDO', 'CNPJ_FUNDO', 'CNPJ Fundo', 'CNPJ do Fundo', 'CNPJ_CESSIONARIO'];

/** Nome do fundo comparável entre arquivos e cadastro: sem acento, pontuação nem espaço repetido. */
export function normalizarNomeFundo(textoNome: unknown): string {
  return String(textoNome ?? '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[^A-Za-z0-9]+/g, ' ').trim().toUpperCase();
}

/** Cabeçalho e primeira linha com dados (sem ler o arquivo inteiro quando dá). */
async function primeiraLinha(a: Arquivo): Promise<[string[], string[]]> {
  if (a.nome.toLowerCase().endsWith('.csv')) {
    const pedaco = a.conteudo.subarray(0, 64 * 1024);
    const fim = pedaco.lastIndexOf(10);
    let textoCsv: string;
    const bytes = fim > 0 ? pedaco.subarray(0, fim) : pedaco;
    try {
      textoCsv = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      textoCsv = decodificarLatin1(bytes);
    }
    textoCsv = textoCsv.replace(/^﻿/, '').replace(/^ï»¿/, '');
    const [cab = [], ...resto] = tokenizarCsv(textoCsv);
    const linha = resto.find((l) => l.some((c) => c.trim())) ?? [];
    return [cab.map((c) => c.trim()), linha.map((c) => c.trim())];
  }
  const [cab = [], ...resto] = await linhasDoExcel(a.conteudo, 50);
  const linha = resto.find((l) => l.some((c) => c !== '' && c !== null)) ?? [];
  return [cab.map((c) => textoPandas(c as never)), linha.map((c) => (c === '' || c === null ? '' : textoPandas(c as never)))];
}

export type Inspecao = { nome: string; data_base: string | null; fundo_nome: string | null; fundo_cnpj: string | null };

export async function inspecionar(arquivos: Arquivo[], comDataBase: boolean): Promise<Inspecao[]> {
  const saida: Inspecao[] = [];
  for (const a of arquivos) {
    let data: string | null = null;
    let nome: string | null = null;
    let cnpj: string | null = null;
    try {
      if (comDataBase) data = dataBaseDoQuadro(normalizarColunas(await lerPlanilha(a)));
    } catch {
      data = null;
    }
    try {
      const [cab, linha] = await primeiraLinha(a);
      const valor = (colunas: string[]) => colunas.map((c) => linha[cab.indexOf(c)]).find((v) => v && v !== '-' && String(v).trim());
      nome = normalizarNomeFundo(valor(COLUNAS_NOME)) || null;
      const d = digitos(valor(COLUNAS_CNPJ) ?? '');
      cnpj = d.length === 14 ? d : null;
    } catch {
      /* arquivo ilegível: não identifica nada */
    }
    saida.push({ nome: a.nome, data_base: data, fundo_nome: nome, fundo_cnpj: cnpj });
  }
  return saida;
}
