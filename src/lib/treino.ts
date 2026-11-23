import { chaveDoPdf, gravarArquivo, lerArquivo } from '@/lib/arquivos';
import { randomUUID } from 'node:crypto';
import { db, emBlocos, type Valor } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';
import type { ClienteGemini } from '@/lib/ia/cliente';
import { custoUsd, MENSAGEM_SEM_CHAVE, semSegredo } from '@/lib/ia/config';
import { lerComConfig, somarTentativas } from '@/lib/ia/leitura';
import { hashConfig, validarConfig, type ConfigTipo } from '@/lib/ia/personalizados';
import { FalhaGeminiComCusto } from '@/lib/ia/retry';

/**
 * Gestão › Treinar IA — porta de routes/treinamento/{tipos_documento,documentos_treinar}.py.
 *
 * - Tipos treinados: descrever → testar num PDF de exemplo → salvar. O salvar exige um teste
 *   da MESMA configuração nas últimas 24 h (hash em uso_ia, etapa 'treinamento_teste').
 * - Documentos para treinar: PDFs do Anexo que a IA classificou como "outro documento" ou
 *   "intervenção humana" e nunca leu. Dá para separar em grupos, ignorar e, depois de treinar
 *   o tipo, ler de novo.
 */

const agora = () => new Date().toISOString();
export const LIMITE_TESTES_POR_DIA = 60;
const MAX_PDF = 20 * 1024 * 1024;

export type TipoTreinado = ConfigTipo & {
  id: number; ativo: boolean; versao: number; tem_amostra: boolean; criado_em: string; atualizado_em: string; documentos_lidos: number;
};

type Linha = Omit<TipoTreinado, 'campos' | 'multi_recebiveis' | 'ativo' | 'tem_amostra' | 'documentos_lidos'> & { campos: string; multi_recebiveis: number; ativo: number; amostra: string | null };

/** Converte as linhas, contando os documentos lidos de todos os tipos numa consulta só. */
async function deLinhas(ls: Linha[]): Promise<TipoTreinado[]> {
  if (!ls.length) return [];
  const slugs = [...new Set(ls.map((l) => l.slug))];
  const lidos = new Map((await (await db()).prepare(`SELECT tipo_documento, COUNT(DISTINCT documento_id) n FROM leituras
    WHERE origem = 'ia' AND tipo_documento IN (${slugs.map(() => '?').join(',')}) GROUP BY tipo_documento`)
    .all<{ tipo_documento: string; n: number }>(...slugs)).map((r) => [r.tipo_documento, r.n]));
  return ls.map((l) => deLinha(l, lidos.get(l.slug) ?? 0));
}

function deLinha(l: Linha, lidos: number): TipoTreinado {
  return {
    id: l.id, slug: l.slug, nome_exibicao: l.nome_exibicao, descricao_identificacao: l.descricao_identificacao, instrucoes_gerais: l.instrucoes_gerais,
    campos: JSON.parse(l.campos), multi_recebiveis: Boolean(l.multi_recebiveis), instrucao_parcelas: l.instrucao_parcelas,
    ativo: Boolean(l.ativo), versao: l.versao, tem_amostra: Boolean(l.amostra), criado_em: l.criado_em, atualizado_em: l.atualizado_em, documentos_lidos: lidos,
  };
}

export async function listarTipos(busca?: string | null): Promise<TipoTreinado[]> {
  const t = `%${(busca ?? '').trim()}%`;
  return deLinhas(await (await db()).prepare(`SELECT * FROM tipos_documento WHERE excluido_em IS NULL AND (nome_exibicao LIKE ? OR slug LIKE ?) ORDER BY nome_exibicao COLLATE NOCASE`).all<Linha>(t, t));
}

export async function listarDesativados(): Promise<TipoTreinado[]> {
  return deLinhas(await (await db()).prepare('SELECT * FROM tipos_documento WHERE excluido_em IS NOT NULL ORDER BY excluido_em DESC').all<Linha>());
}

export async function obterTipo(id: number): Promise<TipoTreinado> {
  const l = await (await db()).prepare('SELECT * FROM tipos_documento WHERE id = ?').get<Linha>(id);
  if (!l) throw new ErroDeUso('Tipo de documento não encontrado.', 404);
  return (await deLinhas([l]))[0];
}

/** Tipos que entram na classificação e na leitura do Anexo. Falha aberta: sem tabela, só os nativos. */
export async function tiposAtivos(): Promise<ConfigTipo[]> {
  try {
    // A classificação não usa a contagem de documentos lidos: sem a consulta extra.
    return (await (await db()).prepare('SELECT * FROM tipos_documento WHERE ativo = 1 AND excluido_em IS NULL ORDER BY id').all<Linha>()).map((l) => deLinha(l, 0));
  } catch (e) {
    console.error('Treinar IA: tipos treinados indisponíveis (seguindo com os nativos)', e);
    return [];
  }
}

export async function amostraDoTipo(id: number): Promise<Uint8Array> {
  const l = await (await db()).prepare('SELECT amostra FROM tipos_documento WHERE id = ?').get<{ amostra: string | null }>(id);
  if (!l?.amostra) throw new ErroDeUso('Este tipo não tem PDF de exemplo.', 404);
  const bytes = await lerArquivo(l.amostra);
  if (!bytes) throw new ErroDeUso('O PDF de exemplo não está mais no armazenamento.', 404);
  return bytes;
}

function conferirPdf(bytes: Uint8Array) {
  if (bytes.length > MAX_PDF) throw new ErroDeUso('O PDF de exemplo pode ter no máximo 20 MB.', 413);
  if (new TextDecoder('latin1').decode(bytes.slice(0, 1024)).indexOf('%PDF') < 0) throw new ErroDeUso('O arquivo não parece um PDF.', 422);
}

async function guardarAmostra(bytes: Uint8Array): Promise<string> {
  conferirPdf(bytes);
  const nome = `treino/${randomUUID()}.pdf`;
  await gravarArquivo(nome, bytes, 'application/pdf');
  return nome;
}

async function exigirTestePrevio(cfg: ConfigTipo) {
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const ok = await (await db()).prepare("SELECT 1 FROM uso_ia WHERE etapa = 'treinamento_teste' AND mensagem = ? AND criado_em >= ? LIMIT 1").get(`teste ok hash=${hashConfig(cfg)}`, desde);
  if (!ok) throw new ErroDeUso('Execute o teste de extração com esta configuração antes de salvar.', 422);
}

async function slugEmUso(slug: string, exceto?: number) {
  const r = await (await db()).prepare('SELECT id FROM tipos_documento WHERE slug = ? AND excluido_em IS NULL AND id IS NOT ?').get(slug, exceto ?? null);
  if (r) throw new ErroDeUso('Já existe um tipo treinado com esse nome. Escolha outro.', 409);
}

export async function criarTipo(dados: unknown, amostra?: Uint8Array | null): Promise<TipoTreinado> {
  const cfg = validarConfig(dados);
  await exigirTestePrevio(cfg);
  await slugEmUso(cfg.slug);
  const r = await (await db()).prepare(`INSERT INTO tipos_documento (slug, nome_exibicao, descricao_identificacao, instrucoes_gerais, campos, multi_recebiveis, instrucao_parcelas, amostra, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(cfg.slug, cfg.nome_exibicao, cfg.descricao_identificacao, cfg.instrucoes_gerais, JSON.stringify(cfg.campos),
    cfg.multi_recebiveis ? 1 : 0, cfg.instrucao_parcelas, amostra?.length ? await guardarAmostra(amostra) : null, agora(), agora());
  return obterTipo(r.lastInsertRowid);
}

/** `versaoEsperada`: recusa salvar por cima de uma edição mais nova (outra aba). */
export async function atualizarTipo(id: number, dados: unknown, versaoEsperada: number, amostra?: Uint8Array | null): Promise<TipoTreinado> {
  const atual = await obterTipo(id);
  if (atual.versao !== versaoEsperada) throw new ErroDeUso('Este tipo foi alterado em outro lugar depois que você abriu. Recarregue e refaça a alteração.', 409);
  const cfg = validarConfig(dados);
  await exigirTestePrevio(cfg);
  await slugEmUso(cfg.slug, id);
  await (await db()).prepare(`UPDATE tipos_documento SET slug = ?, nome_exibicao = ?, descricao_identificacao = ?, instrucoes_gerais = ?, campos = ?, multi_recebiveis = ?,
      instrucao_parcelas = ?, amostra = COALESCE(?, amostra), versao = versao + 1, atualizado_em = ? WHERE id = ?`)
    .run(cfg.slug, cfg.nome_exibicao, cfg.descricao_identificacao, cfg.instrucoes_gerais, JSON.stringify(cfg.campos), cfg.multi_recebiveis ? 1 : 0,
      cfg.instrucao_parcelas, amostra?.length ? await guardarAmostra(amostra) : null, agora(), id);
  return obterTipo(id);
}

export async function excluirTipo(id: number): Promise<void> {
  await obterTipo(id);
  await (await db()).prepare('UPDATE tipos_documento SET ativo = 0, excluido_em = ?, atualizado_em = ? WHERE id = ?').run(agora(), agora(), id);
}

export async function restaurarTipo(id: number): Promise<TipoTreinado> {
  const t = await obterTipo(id);
  await slugEmUso(t.slug, id);
  await (await db()).prepare('UPDATE tipos_documento SET ativo = 1, excluido_em = NULL, versao = versao + 1, atualizado_em = ? WHERE id = ?').run(agora(), id);
  return obterTipo(id);
}

export type ResultadoTeste = { linhas: Record<string, unknown>[]; total_linhas: number; tokens_entrada: number; tokens_saida: number; custo_usd: number | null; modelo: string; hash_config: string };

/**
 * Lê o PDF de exemplo com a configuração (sem gravar leitura). O sucesso registra o hash da
 * configuração: é o que libera o "Salvar".
 */
export async function testarExtracao(pdf: Uint8Array, dados: unknown, deps: { cliente: () => Promise<ClienteGemini | null>; modelo: string }): Promise<ResultadoTeste> {
  const cfg = validarConfig(dados);
  conferirPdf(pdf);
  const hoje = new Date();
  const inicioDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).toISOString();
  const c = await db();
  const feitos = (await c.prepare("SELECT COUNT(*) n FROM uso_ia WHERE etapa = 'treinamento_teste' AND criado_em >= ?").get<{ n: number }>(inicioDoDia))!.n;
  if (feitos >= LIMITE_TESTES_POR_DIA) throw new ErroDeUso(`Limite de ${LIMITE_TESTES_POR_DIA} testes de extração por dia atingido. Cada teste é cobrado pelo Google; tente amanhã.`, 429);
  const cliente = await deps.cliente();
  if (!cliente) throw new ErroDeUso(MENSAGEM_SEM_CHAVE);
  const hash = hashConfig(cfg);
  const registrar = (entrada: number, saida: number, mensagem: string) => c.prepare(`INSERT INTO uso_ia (base_id, documento_id, etapa, modelo, tokens_entrada, tokens_saida, custo_usd, criado_em, mensagem)
      VALUES (NULL, NULL, 'treinamento_teste', ?, ?, ?, ?, ?, ?)`).run(deps.modelo, entrada, saida, custoUsd(deps.modelo, entrada, saida), agora(), mensagem.slice(0, 500));
  try {
    const r = await lerComConfig(cliente, pdf, cfg, { modelo: deps.modelo });
    const uso = somarTentativas(r.tentativas);
    await registrar(uso.tokensEntrada, uso.tokensSaida, `teste ok hash=${hash}`);
    return {
      linhas: r.registros, total_linhas: r.registros.length, tokens_entrada: uso.tokensEntrada, tokens_saida: uso.tokensSaida,
      custo_usd: custoUsd(deps.modelo, uso.tokensEntrada, uso.tokensSaida), modelo: deps.modelo, hash_config: hash,
    };
  } catch (e) {
    if (e instanceof FalhaGeminiComCusto) {
      const uso = somarTentativas(e.tentativas);
      await registrar(uso.tokensEntrada, uso.tokensSaida, `teste falhou: ${semSegredo(e.message)}`);
    }
    throw new ErroDeUso(`A IA não conseguiu extrair com essa configuração: ${semSegredo(e instanceof Error ? e.message : String(e))}. Ajuste as descrições e teste de novo.`, 422);
  }
}

// ---------------------------------------------------------------------------
// Documentos para treinar
// ---------------------------------------------------------------------------

export type Candidato = {
  documento_id: number; nome_arquivo: string; caminho: string; base_id: string; base_nome: string; motivo: string;
  classificado_em: string; pdf_id: number | null; situacao: 'separado' | 'ignorado' | 'treinado' | null; grupo: string | null; tipo_treinado: string | null;
};

const CANDIDATOS = `
  SELECT d.id AS documento_id, d.nome_arquivo, d.caminho, l.base_id, b.nome AS base_nome, d.tipo_documento AS motivo,
         d.atualizado_em AS classificado_em, d.pdf_id, t.situacao, t.grupo, td.nome_exibicao AS tipo_treinado
    FROM anexo_documentos d
    JOIN anexo_lotes l ON l.id = d.lote_id
    JOIN bases b ON b.id = l.base_id
    LEFT JOIN treino_documentos t ON t.documento_id = d.id
    LEFT JOIN tipos_documento td ON td.id = t.tipo_documento_id
   WHERE d.tipo_documento IN ('outro_documento', 'intervencao_humana')
     AND NOT EXISTS (SELECT 1 FROM leituras le WHERE le.documento_id = d.id AND le.origem = 'ia')`;

export async function listarCandidatos(f: { baseId?: string | null; pendentes?: boolean; busca?: string | null; pagina?: number; tamanho?: number } = {}) {
  const cond: string[] = [];
  const params: (string | number)[] = [];
  if (f.baseId) { cond.push('l.base_id = ?'); params.push(f.baseId); }
  if (f.pendentes) cond.push('t.documento_id IS NULL');
  if (f.busca?.trim()) { cond.push('(d.nome_arquivo LIKE ? OR d.caminho LIKE ?)'); params.push(`%${f.busca.trim()}%`, `%${f.busca.trim()}%`); }
  const sql = `${CANDIDATOS}${cond.length ? ` AND ${cond.join(' AND ')}` : ''}`;
  const c = await db();
  const total = (await c.prepare(`SELECT COUNT(*) n FROM (${sql})`).get<{ n: number }>(...params))!.n;
  const tamanho = Math.min(200, Math.max(1, f.tamanho ?? 50));
  const pagina = Math.max(1, f.pagina ?? 1);
  const itens = await c.prepare(`${sql} ORDER BY d.atualizado_em DESC, d.id DESC LIMIT ? OFFSET ?`).all<Candidato>(...params, tamanho, (pagina - 1) * tamanho);
  return { itens, total, pagina, tamanho };
}

export async function resumoTreino() {
  const c = await db();
  const todos = await c.prepare(`SELECT situacao, COUNT(*) n FROM (${CANDIDATOS}) GROUP BY situacao`).all() as { situacao: string | null; n: number }[];
  const n = (s: string | null) => todos.find((x) => x.situacao === s)?.n ?? 0;
  const grupos = await c.prepare(`SELECT COALESCE(grupo, '') AS grupo, COUNT(*) n FROM treino_documentos WHERE situacao = 'separado' GROUP BY grupo ORDER BY grupo`).all() as { grupo: string; n: number }[];
  const bases = await c.prepare(`SELECT base_id, base_nome, COUNT(*) n, SUM(situacao IS NULL) pendentes FROM (${CANDIDATOS}) GROUP BY base_id ORDER BY n DESC`).all() as { base_id: string; base_nome: string; n: number; pendentes: number }[];
  return { pendentes: n(null), separados: n('separado'), ignorados: n('ignorado'), treinados: n('treinado'), grupos, bases };
}

const normalizarGrupo = (g: unknown) => (g === null || g === undefined ? null : String(g).replace(/\s+/g, ' ').trim().slice(0, 120) || null);

function exigirIds(ids: unknown): number[] {
  const lista = Array.isArray(ids) ? ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (!lista.length) throw new ErroDeUso('Selecione ao menos um documento.');
  if (lista.length > 5000) throw new ErroDeUso('No máximo 5.000 documentos por vez.');
  return lista;
}

/** Roda o mesmo comando para cada id, em lotes (uma ida por lote), e soma as linhas mudadas. */
async function paraCada(ids: number[], sql: string, args: (id: number) => Valor[]): Promise<number> {
  const c = await db();
  let n = 0;
  for (const bloco of emBlocos(ids, 200)) {
    for (const r of await c.lote(bloco.map((id) => ({ sql, args: args(id) })))) n += r.changes;
  }
  return n;
}

export async function decidir(ids: unknown, situacao: 'separado' | 'ignorado', grupo?: unknown): Promise<number> {
  if (situacao !== 'separado' && situacao !== 'ignorado') throw new ErroDeUso('Situação inválida.');
  const g = situacao === 'separado' ? normalizarGrupo(grupo) : null;
  const ts = agora();
  return paraCada(exigirIds(ids), `INSERT INTO treino_documentos (documento_id, situacao, grupo, decidido_em) VALUES (?, ?, ?, ?)
    ON CONFLICT (documento_id) DO UPDATE SET situacao = excluded.situacao, grupo = excluded.grupo, tipo_documento_id = NULL, decidido_em = excluded.decidido_em`,
  (id) => [id, situacao, g, ts]);
}

export async function moverParaGrupo(ids: unknown, grupo: unknown): Promise<number> {
  const g = normalizarGrupo(grupo);
  const ts = agora();
  return paraCada(exigirIds(ids), "UPDATE treino_documentos SET grupo = ?, decidido_em = ? WHERE documento_id = ? AND situacao = 'separado'", (id) => [g, ts, id]);
}

export async function desfazer(ids: unknown): Promise<number> {
  return paraCada(exigirIds(ids), 'DELETE FROM treino_documentos WHERE documento_id = ?', (id) => [id]);
}

export async function marcarTreinados(ids: unknown, tipoId: number): Promise<number> {
  await obterTipo(tipoId);
  const ts = agora();
  return paraCada(exigirIds(ids), `INSERT INTO treino_documentos (documento_id, situacao, tipo_documento_id, decidido_em) VALUES (?, 'treinado', ?, ?)
    ON CONFLICT (documento_id) DO UPDATE SET situacao = 'treinado', tipo_documento_id = excluded.tipo_documento_id, decidido_em = excluded.decidido_em`,
  (id) => [id, tipoId, ts]);
}

/** Bytes do PDF de um candidato (para ver ou usar como exemplo do tipo). */
export async function pdfDoDocumento(documentoId: number): Promise<{ nome: string; bytes: Uint8Array }> {
  const d = await (await db()).prepare(`SELECT d.nome_arquivo, p.sha256, l.base_id FROM anexo_documentos d JOIN anexo_lotes l ON l.id = d.lote_id
    LEFT JOIN pdfs p ON p.id = d.pdf_id WHERE d.id = ?`).get<{ nome_arquivo: string; sha256: string | null; base_id: string }>(documentoId);
  if (!d?.sha256) throw new ErroDeUso('O PDF deste documento não está mais na base.', 404);
  const bytes = await lerArquivo(chaveDoPdf(d.base_id, d.sha256));
  if (!bytes) throw new ErroDeUso('O PDF deste documento não está mais no armazenamento.', 404);
  return { nome: d.nome_arquivo, bytes };
}
