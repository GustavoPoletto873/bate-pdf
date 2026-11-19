import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { db, pastaDeDados } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';
import { formatarCpfCnpj } from '@/lib/texto';
import { renderizar, marcadoresDoModelo } from './docx';
import { construirContexto, listasDoSnapshot } from './formatos';
import { baixarInforme, coletarCarteiras, LINHA_VENCIDOS, LINHA_VINCENDOS, type Baixar, type Carteira } from './informe';
import {
  CENARIO_COM_DC, CENARIO_SEM_BASE, CENARIO_SEM_DC, CENARIO_SEM_MOVIMENTACAO, montarSnapshot, rotuloTrimestre, semPendencias,
  trimestreCurto, type Fundo, type Snapshot,
} from './snapshot';
import { escolhasIniciais, resolverTextos, secoesPara } from './textos';

/**
 * Gestão › Relatórios CVM/NIX — porta de services/Relatorios/relatorio_service.py do Bate Lastro.
 * Fluxo: data-base → coletar carteira do informe mensal → rascunho (snapshot congelado) →
 * revisar textos → emitir (um fundo ou em lote).
 */

export const TIPOS = ['CVM', 'NIX'] as const;
export type TipoRelatorio = (typeof TIPOS)[number];

const agora = () => new Date().toISOString();
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const fimDoMes = (ano: number, mes: number) => new Date(ano, mes, 0); // mes 1..12
const pastaModelos = () => join(/*turbopackIgnore: true*/ process.cwd(), 'modelos', 'relatorios');

// ---------------------------------------------------------------------------
// Datas-base
// ---------------------------------------------------------------------------

export type DataBaseOpcao = { data_base: string; rotulo: string; trimestre: string; trimestre_curto: string; antecipada: boolean };
export type Trimestre = { trimestre: string; trimestre_curto: string; datas_base: DataBaseOpcao[] };

/**
 * Cada trimestre oferece o mês de fechamento e o anterior (amostra antecipada); só entram
 * meses já encerrados (antes disso a CVM não publicou o informe).
 */
export function trimestresDisponiveis(hoje = new Date(), quantos = 8): Trimestre[] {
  const saida: Trimestre[] = [];
  let ano = hoje.getFullYear();
  let mesFim = (Math.floor(hoje.getMonth() / 3) + 1) * 3;
  const referencia = iso(hoje);
  for (let i = 0; i < quantos; i++) {
    const fechamento = iso(fimDoMes(ano, mesFim));
    const anterior = iso(fimDoMes(ano, mesFim - 1));
    const datas = ([[fechamento, false], [anterior, true]] as const)
      .filter(([d]) => d <= referencia)
      .map(([d, antecipada]) => ({ data_base: d, rotulo: `${d.slice(5, 7)}/${d.slice(0, 4)}`, trimestre: rotuloTrimestre(fechamento), trimestre_curto: trimestreCurto(fechamento), antecipada }));
    if (datas.length) saida.push({ trimestre: rotuloTrimestre(fechamento), trimestre_curto: trimestreCurto(fechamento), datas_base: datas });
    mesFim -= 3;
    if (mesFim <= 0) { mesFim += 12; ano--; }
  }
  return saida;
}

function intervaloDoTrimestre(dataBase: string): [string, string] {
  const [ano, mes] = dataBase.split('-').map(Number);
  const inicio = Math.floor((mes - 1) / 3) * 3 + 1;
  return [`${ano}-${String(inicio).padStart(2, '0')}-01`, iso(fimDoMes(ano, inicio + 2))];
}

// ---------------------------------------------------------------------------
// Fundos, bases e carteiras
// ---------------------------------------------------------------------------

type LinhaFundo = { id: number; nome: string; cnpj: string; tipo: 'FIDC' | 'FIC_FIDC'; adm_id: number | null; adm_nome: string | null; razao_social: string | null; endereco: string | null; endereco_complemento: string | null };

function fundos(ids?: number[]): Fundo[] {
  const filtro = ids ? `WHERE f.id IN (${ids.map(() => '?').join(',') || 'NULL'})` : '';
  return (db().prepare(`SELECT f.id, f.nome, f.cnpj, f.tipo, a.id AS adm_id, a.nome AS adm_nome, a.razao_social, a.endereco, a.endereco_complemento
      FROM fundos f LEFT JOIN administradoras a ON a.id = f.administradora_id ${filtro} ORDER BY f.nome COLLATE NOCASE`).all(...(ids ?? [])) as LinhaFundo[])
    .map((f) => ({
      id: f.id, nome: f.nome, cnpj: f.cnpj, tipo: f.tipo,
      administrador: { id: f.adm_id, nome: f.adm_nome, razao_social: f.razao_social, endereco: f.endereco, endereco_complemento: f.endereco_complemento },
    }));
}

function fundo(id: number): Fundo {
  const [f] = fundos([id]);
  if (!f) throw new ErroDeUso('Fundo não encontrado.', 404);
  return f;
}

/** Base de auditoria do trimestre da data-base (a mais recente); sem base no trimestre = sem movimentação. */
export function baseDoTrimestre(f: Pick<Fundo, 'id' | 'cnpj'>, dataBase: string): { id: string; nome: string } | null {
  const [de, ate] = intervaloDoTrimestre(dataBase);
  return (db().prepare(`SELECT id, nome FROM bases
     WHERE (fundo_id = ? OR replace(replace(replace(COALESCE(cnpj_fundo, ''), '.', ''), '/', ''), '-', '') = ?)
       AND substr(data_referencia, 1, 10) BETWEEN ? AND ?
     ORDER BY criado_em DESC LIMIT 1`).get(f.id, f.cnpj, de, ate) as { id: string; nome: string } | undefined) ?? null;
}

function carteiraEmCache(fundoId: number, dataBase: string): Carteira | null {
  const r = db().prepare('SELECT dados FROM relatorio_carteiras WHERE fundo_id = ? AND data_base = ?').get(fundoId, dataBase) as { dados: string } | undefined;
  return r ? (JSON.parse(r.dados) as Carteira) : null;
}

/**
 * Carteira de cada fundo na data-base, usando o cache. O ZIP da CVM é baixado só se algum
 * fundo não tiver cache (é o mesmo arquivo para todos).
 */
export async function coletarCarteirasPara(lista: Fundo[], dataBase: string, opcoes: { forcar?: boolean; baixar?: Baixar } = {}): Promise<Map<number, Carteira | null>> {
  const saida = new Map<number, Carteira | null>();
  const faltam = lista.filter((f) => {
    const c = opcoes.forcar ? null : carteiraEmCache(f.id, dataBase);
    if (c) saida.set(f.id, c);
    return !c;
  });
  if (faltam.length) {
    const tabelas = await baixarInforme(dataBase, opcoes.baixar, opcoes.forcar);
    const carteiras = coletarCarteiras(dataBase, faltam.map((f) => formatarCpfCnpj(f.cnpj)), tabelas);
    const gravar = db().prepare(`INSERT INTO relatorio_carteiras (fundo_id, data_base, dados, coletado_em) VALUES (?, ?, ?, ?)
      ON CONFLICT (fundo_id, data_base) DO UPDATE SET dados = excluded.dados, coletado_em = excluded.coletado_em`);
    for (const f of faltam) {
      const c = carteiras.get(formatarCpfCnpj(f.cnpj)) ?? null;
      saida.set(f.id, c);
      if (c) gravar.run(f.id, dataBase, JSON.stringify(c), agora());
    }
  }
  return saida;
}

export async function coletarTodas(dataBase: string, forcar = false, baixar?: Baixar) {
  const lista = fundos();
  if (!lista.length) throw new ErroDeUso('Cadastre os fundos em Gestão › Fundos antes de coletar as carteiras.');
  const r = await coletarCarteirasPara(lista, dataBase, { forcar, baixar });
  const comCarteira = [...r.values()].filter(Boolean).length;
  return { fundos: lista.length, com_carteira: comCarteira, sem_carteira: lista.length - comCarteira };
}

export function preverCenario(temCarteira: boolean, totalDc: number, temBase: boolean, amostraRascunho: number | null): string | null {
  if (!temCarteira) return null;
  if (!totalDc) return CENARIO_SEM_DC;
  if (!temBase) return CENARIO_SEM_BASE;
  if (amostraRascunho === 0) return CENARIO_SEM_MOVIMENTACAO;
  return CENARIO_COM_DC;
}

export type FundoParaEmissao = {
  id: number; nome: string; cnpj: string; tipo: 'FIDC' | 'FIC_FIDC'; administrador: string;
  tem_carteira: boolean; tem_base: boolean; base_nome: string | null; rascunho_id: string | null; cenario: string | null;
  emitidos: { tipo: string; criado_em: string }[];
};

export function fundosParaEmissao(dataBase: string, busca?: string | null): FundoParaEmissao[] {
  const termo = (busca ?? '').trim().toLowerCase();
  const digitosBusca = termo.replace(/\D/g, '');
  return fundos().filter((f) => !termo || f.nome.toLowerCase().includes(termo) || (digitosBusca.length >= 3 && f.cnpj.includes(digitosBusca))).map((f) => {
    const carteira = carteiraEmCache(f.id, dataBase);
    const base = baseDoTrimestre(f, dataBase);
    const rascunho = db().prepare('SELECT id, snapshot FROM relatorio_rascunhos WHERE fundo_id = ? AND data_base = ?').get(f.id, dataBase) as { id: string; snapshot: string } | undefined;
    const amostra = rascunho ? (JSON.parse(rascunho.snapshot) as Snapshot).amostra.total_quantidade : null;
    const totalDc = carteira ? (carteira.linhas[LINHA_VINCENDOS] ?? 0) + (carteira.linhas[LINHA_VENCIDOS] ?? 0) : 0;
    const emitidos = rascunho ? db().prepare(`SELECT tipo, MAX(criado_em) criado_em FROM relatorio_emissoes WHERE rascunho_id = ? GROUP BY tipo`).all(rascunho.id) as { tipo: string; criado_em: string }[] : [];
    return {
      id: f.id, nome: f.nome, cnpj: formatarCpfCnpj(f.cnpj), tipo: f.tipo, administrador: f.administrador.nome ?? 'Não informado',
      tem_carteira: Boolean(carteira), tem_base: Boolean(base), base_nome: base?.nome ?? null, rascunho_id: rascunho?.id ?? null,
      cenario: preverCenario(Boolean(carteira), totalDc, Boolean(base), amostra), emitidos,
    };
  });
}

// ---------------------------------------------------------------------------
// Modelos
// ---------------------------------------------------------------------------

function arquivoDoModelo(tipo: TipoRelatorio, f: Pick<Fundo, 'tipo'>, cenario: string): string {
  const caminho = join(pastaModelos(), `${tipo}_${f.tipo}_${cenario}.docx`);
  if (!existsSync(caminho)) throw new ErroDeUso(`Não há modelo ${tipo} para ${f.tipo === 'FIC_FIDC' ? 'FIC FIDC' : 'FIDC'} / ${cenario} na pasta modelos/relatorios.`, 500);
  return caminho;
}

async function roteiroDoCvm(f: Fundo, cenario: string): Promise<'numerado' | 'romano'> {
  try {
    const marcadores = await marcadoresDoModelo(new Uint8Array(readFileSync(arquivoDoModelo('CVM', f, cenario))));
    return marcadores.includes('cvm_01') ? 'numerado' : 'romano';
  } catch {
    return ['SEM_DC', 'SEM_MOVIMENTACAO'].includes(cenario) ? 'numerado' : 'romano';
  }
}

// ---------------------------------------------------------------------------
// Rascunhos
// ---------------------------------------------------------------------------

export type Rascunho = {
  id: string; fundo_id: number; data_base: string; revisao: number; cenario: string; snapshot: Snapshot;
  escolhas: Record<string, string>; overrides: Record<string, string>; secoes: ReturnType<typeof secoesPara>;
  textos: Record<string, string>; atualizado_em: string;
  emissoes: { id: string; tipo: string; nome_arquivo: string; criado_em: string; sem_pendencias: boolean; revisao: number }[];
};

export async function prepararRascunho(fundoId: number, dataBase: string, opcoes: { antecipada?: boolean; forcar?: boolean; baixar?: Baixar } = {}): Promise<Rascunho> {
  const f = fundo(fundoId);
  const carteira = (await coletarCarteirasPara([f], dataBase, { forcar: opcoes.forcar, baixar: opcoes.baixar })).get(f.id) ?? null;
  const base = baseDoTrimestre(f, dataBase);
  const snapshot = montarSnapshot(f, carteira, dataBase, base, Boolean(opcoes.antecipada));
  snapshot.roteiro_cvm = await roteiroDoCvm(f, snapshot.cenario);
  let escolhas = escolhasIniciais(snapshot);
  const existente = db().prepare('SELECT id, escolhas FROM relatorio_rascunhos WHERE fundo_id = ? AND data_base = ?').get(f.id, dataBase) as { id: string; escolhas: string } | undefined;
  if (existente) {
    // Mantém o que a pessoa já revisou; só os números são refeitos.
    escolhas = { ...escolhas, ...(JSON.parse(existente.escolhas) as Record<string, string>) };
    db().prepare(`UPDATE relatorio_rascunhos SET snapshot = ?, escolhas = ?, cenario = ?, antecipada = ?, base_id = ?, revisao = revisao + 1, atualizado_em = ? WHERE id = ?`)
      .run(JSON.stringify(snapshot), JSON.stringify(escolhas), snapshot.cenario, opcoes.antecipada ? 1 : 0, base?.id ?? null, agora(), existente.id);
    return obterRascunho(existente.id);
  }
  const id = randomUUID();
  db().prepare(`INSERT INTO relatorio_rascunhos (id, fundo_id, data_base, base_id, antecipada, cenario, snapshot, escolhas, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, f.id, dataBase, base?.id ?? null, opcoes.antecipada ? 1 : 0, snapshot.cenario, JSON.stringify(snapshot), JSON.stringify(escolhas), agora(), agora());
  return obterRascunho(id);
}

export function obterRascunho(id: string): Rascunho {
  const r = db().prepare('SELECT * FROM relatorio_rascunhos WHERE id = ?').get(id) as
    { id: string; fundo_id: number; data_base: string; revisao: number; cenario: string; snapshot: string; escolhas: string; overrides: string; atualizado_em: string } | undefined;
  if (!r) throw new ErroDeUso('Rascunho não encontrado. Prepare o relatório de novo.', 404);
  const snapshot = JSON.parse(r.snapshot) as Snapshot;
  const escolhas = JSON.parse(r.escolhas) as Record<string, string>;
  const overrides = JSON.parse(r.overrides) as Record<string, string>;
  const emissoes = (db().prepare('SELECT id, tipo, nome_arquivo, criado_em, sem_pendencias, revisao FROM relatorio_emissoes WHERE rascunho_id = ? ORDER BY criado_em DESC').all(id) as
    { id: string; tipo: string; nome_arquivo: string; criado_em: string; sem_pendencias: number; revisao: number }[]).map((e) => ({ ...e, sem_pendencias: Boolean(e.sem_pendencias) }));
  return {
    id: r.id, fundo_id: r.fundo_id, data_base: r.data_base, revisao: r.revisao, cenario: r.cenario, snapshot, escolhas, overrides,
    secoes: secoesPara(snapshot), textos: resolverTextos(snapshot, escolhas, overrides), atualizado_em: r.atualizado_em, emissoes,
  };
}

export function salvarEscolhas(id: string, escolhas: Record<string, string>, overrides: Record<string, string>): Rascunho {
  const atual = obterRascunho(id);
  const validas = new Set(atual.secoes.map((s) => s.chave));
  const limpar = (o: Record<string, string>) => Object.fromEntries(Object.entries(o ?? {}).filter(([k, v]) => validas.has(k) && typeof v === 'string'));
  db().prepare('UPDATE relatorio_rascunhos SET escolhas = ?, overrides = ?, atualizado_em = ? WHERE id = ?')
    .run(JSON.stringify({ ...atual.escolhas, ...limpar(escolhas) }), JSON.stringify(limpar(overrides)), agora(), id);
  return obterRascunho(id);
}

// ---------------------------------------------------------------------------
// Emissão
// ---------------------------------------------------------------------------

export function nomeArquivo(tipo: string, nomeFundo: string, cnpj: string): string {
  const nome = nomeFundo.normalize('NFC').replace(/[^\p{L}\p{N} _-]/gu, '').trim();
  return `${tipo}_${nome}_${cnpj.replace(/\D/g, '')}.docx`;
}

export type Emitido = { id: string; tipo: TipoRelatorio; nome_arquivo: string; tamanho: number; sem_pendencias: boolean };

export async function emitir(rascunhoId: string, tipos: TipoRelatorio[], opcoes: { confirmarSemBase?: boolean; semPendencias?: boolean; loteId?: string | null } = {}): Promise<Emitido[]> {
  if (!tipos.length) throw new ErroDeUso('Escolha CVM, NIX ou os dois.');
  const r = obterRascunho(rascunhoId);
  const s = r.snapshot;
  if (!s.carteira.disponivel) {
    throw new ErroDeUso('Não há carteira do informe mensal da CVM para este fundo na data-base. Confira o CNPJ do fundo ou atualize a coleta antes de emitir.');
  }
  if (s.sem_base && r.cenario === CENARIO_SEM_MOVIMENTACAO && !opcoes.confirmarSemBase) {
    throw new ErroDeUso('O fundo tem direitos creditórios na carteira, mas nenhuma base de auditoria foi enviada no trimestre. Envie a base ou confirme a emissão como sem movimentação.', 409);
  }
  const f = fundo(r.fundo_id);
  // Identidade atual do cadastro; os números continuam os do rascunho.
  const snapshot: Snapshot = { ...s, administrador: f.administrador };
  const pasta = join(/*turbopackIgnore: true*/ pastaDeDados(), 'relatorios');
  mkdirSync(pasta, { recursive: true });
  const saida: Emitido[] = [];
  for (const tipo of tipos) {
    if (!TIPOS.includes(tipo)) throw new ErroDeUso(`Tipo de relatório inválido: ${tipo}`);
    const oculta = Boolean(opcoes.semPendencias) && tipo === 'CVM'; // o NIX sai sempre com todas
    const dados = oculta ? semPendencias(snapshot) : snapshot;
    const modelo = new Uint8Array(readFileSync(arquivoDoModelo(tipo, f, r.cenario)));
    const conteudo = await renderizar(modelo, construirContexto(dados, r.textos), listasDoSnapshot(dados));
    const id = randomUUID();
    const nome = nomeArquivo(tipo, f.nome, f.cnpj);
    writeFileSync(join(pasta, `${id}.docx`), conteudo);
    db().prepare(`INSERT INTO relatorio_emissoes (id, rascunho_id, revisao, tipo, lote_id, nome_arquivo, arquivo, sha256, sem_pendencias, criado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, r.id, r.revisao, tipo, opcoes.loteId ?? null, nome, `relatorios/${id}.docx`,
      createHash('sha256').update(conteudo).digest('hex'), oculta ? 1 : 0, agora());
    saida.push({ id, tipo, nome_arquivo: nome, tamanho: conteudo.length, sem_pendencias: oculta });
  }
  return saida;
}

export type ResultadoLote = { lote_id: string; emitidos: (Emitido & { fundo: string })[]; erros: { fundo: string; erro: string }[] };

/** Prepara e emite vários fundos; o erro de um não para os outros. */
export async function emitirEmLote(fundoIds: number[], dataBase: string, tipos: TipoRelatorio[], opcoes: { antecipada?: boolean; confirmarSemBase?: boolean; semPendencias?: boolean; baixar?: Baixar } = {}): Promise<ResultadoLote> {
  if (!fundoIds.length) throw new ErroDeUso('Selecione ao menos um fundo.');
  const loteId = randomUUID();
  const lista = fundos(fundoIds);
  await coletarCarteirasPara(lista, dataBase, { baixar: opcoes.baixar });
  const emitidos: ResultadoLote['emitidos'] = [];
  const erros: ResultadoLote['erros'] = [];
  for (const f of lista) {
    try {
      const r = await prepararRascunho(f.id, dataBase, { antecipada: opcoes.antecipada, baixar: opcoes.baixar });
      for (const e of await emitir(r.id, tipos, { ...opcoes, loteId })) emitidos.push({ ...e, fundo: f.nome });
    } catch (e) {
      erros.push({ fundo: f.nome, erro: e instanceof Error ? e.message : String(e) });
    }
  }
  return { lote_id: loteId, emitidos, erros };
}

export function arquivoDaEmissao(id: string): { nome: string; conteudo: Uint8Array } {
  const e = db().prepare('SELECT nome_arquivo, arquivo FROM relatorio_emissoes WHERE id = ?').get(id) as { nome_arquivo: string; arquivo: string } | undefined;
  if (!e) throw new ErroDeUso('Relatório não encontrado.', 404);
  const caminho = join(/*turbopackIgnore: true*/ pastaDeDados(), e.arquivo);
  if (!existsSync(caminho)) throw new ErroDeUso('O arquivo deste relatório não está mais na pasta de dados. Emita de novo.', 404);
  return { nome: e.nome_arquivo, conteudo: new Uint8Array(readFileSync(caminho)) };
}

/** ZIP com todos os .docx de um lote. */
export async function zipDoLote(loteId: string): Promise<Uint8Array> {
  const linhas = db().prepare('SELECT id FROM relatorio_emissoes WHERE lote_id = ?').all(loteId) as { id: string }[];
  if (!linhas.length) throw new ErroDeUso('Lote não encontrado.', 404);
  const zip = new JSZip();
  const usados = new Set<string>();
  for (const l of linhas) {
    const a = arquivoDaEmissao(l.id);
    let nome = a.nome;
    for (let i = 2; usados.has(nome); i++) nome = a.nome.replace(/\.docx$/, ` (${i}).docx`);
    usados.add(nome);
    zip.file(nome, a.conteudo);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export function historico(limite = 50) {
  return db().prepare(`SELECT e.id, e.tipo, e.nome_arquivo, e.criado_em, e.sem_pendencias, e.lote_id, r.data_base, f.nome AS fundo
      FROM relatorio_emissoes e JOIN relatorio_rascunhos r ON r.id = e.rascunho_id JOIN fundos f ON f.id = r.fundo_id
     ORDER BY e.criado_em DESC LIMIT ?`).all(limite) as { id: string; tipo: string; nome_arquivo: string; criado_em: string; sem_pendencias: number; lote_id: string | null; data_base: string; fundo: string }[];
}
