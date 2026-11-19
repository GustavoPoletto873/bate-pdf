import { db, transacao } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';
import { digitos, formatarCpfCnpj } from '@/lib/texto';
import { interpretarLista, LIMITE_LOTE } from '@/components/blacklist/lista';

export { interpretarLista, LIMITE_LOTE };

/**
 * Gestão › BlackList (blacklist_service.py do Bate Lastro). Não bloqueia nada: só monitora
 * cedentes e sacados e avisa quando aparecem numa base.
 *
 * Contrato usado por outras telas (o Upload Base chama `varrerBase` logo depois de criar a base
 * e mostra `alertaDaBase` no aviso de conclusão).
 *
 * Diferenças da versão local: um usuário só (sem instituição); a varredura roda na hora (sem fila
 * em segundo plano); bases que entraram por outro caminho são varridas quando a tela abre; o "valor
 * presente" é o valor de aquisição do título, como no Bate Lastro (a base não guarda o presente).
 */

export type AlertaBlackList = {
  entrada_id: number;
  nome: string;
  documento: string;
  papel: 'cedente' | 'sacado';
  linhas: number;
  valor_nominal: number;
  /** Extras (opcionais para quem consome o contrato). */
  valor_aquisicao?: number;
  percentual_nominal?: number;
};

const agora = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Documento (utils/documento.py)
// ---------------------------------------------------------------------------

/** Só dígitos com zeros à esquerda restaurados (CPF 11, CNPJ 14); '' se não pode ser CPF/CNPJ. */
export function normalizarDocumento(valor: unknown): string {
  const d = digitos(valor);
  if (!d || d.length > 14) return '';
  const n = d.padStart(d.length <= 11 ? 11 : 14, '0');
  return new Set(n).size === 1 ? '' : n;
}

export const tipoDocumento = (doc: string) => (doc.length === 11 ? 'CPF' : 'CNPJ');


// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

type LinhaEntrada = { id: number; nome: string; documento: string; tipo_documento: string; criado_em: string; varredura_em: string | null };

export type Entrada = {
  id: number;
  nome: string;
  documento: string;
  documento_formatado: string;
  tipo_documento: string;
  criado_em: string;
  varredura_em: string | null;
};

const entrada = (l: LinhaEntrada): Entrada => ({ ...l, documento_formatado: formatarCpfCnpj(l.documento) });

function ativas(id?: number): LinhaEntrada[] {
  const sql = 'SELECT id, nome, documento, tipo_documento, criado_em, varredura_em FROM blacklist_entradas WHERE excluido_em IS NULL';
  return (id === undefined
    ? db().prepare(`${sql} ORDER BY nome COLLATE NOCASE, id`).all()
    : db().prepare(`${sql} AND id = ?`).all(id)) as LinhaEntrada[];
}

function inserir(nomeInformado: unknown, documentoInformado: unknown): Entrada {
  const nome = String(nomeInformado ?? '').trim();
  if (!nome) throw new ErroDeUso('Informe o nome.');
  const doc = normalizarDocumento(documentoInformado);
  if (!doc) throw new ErroDeUso('CPF/CNPJ inválido. Informe 11 dígitos (CPF) ou 14 dígitos (CNPJ).');
  const existe = db().prepare('SELECT nome FROM blacklist_entradas WHERE documento = ? AND excluido_em IS NULL').get(doc) as { nome: string } | undefined;
  if (existe) throw new ErroDeUso(`Documento já cadastrado na BlackList (${existe.nome}).`);
  const r = db().prepare('INSERT INTO blacklist_entradas (nome, documento, tipo_documento, criado_em) VALUES (?, ?, ?, ?)')
    .run(nome.slice(0, 255), doc, tipoDocumento(doc), agora());
  return entrada(ativas(Number(r.lastInsertRowid))[0]);
}

/** Cadastra e já varre todas as bases (`criar` + `varrer_entrada`). */
export function criar(nome: unknown, documento: unknown): Entrada {
  const e = inserir(nome, documento);
  varrerEntradas([e.id]);
  return entrada(ativas(e.id)[0]);
}

/** Vários de uma vez; o que falhar vira um erro por linha, sem derrubar o resto. */
export function criarLote(itens: { nome?: unknown; documento?: unknown }[]) {
  if (!itens.length) throw new ErroDeUso('Nenhum item informado.');
  if (itens.length > LIMITE_LOTE) throw new ErroDeUso(`Máximo de ${LIMITE_LOTE} itens por lote.`);
  const criados: Entrada[] = [];
  const erros: { linha: number; nome: unknown; documento: unknown; erro: string }[] = [];
  itens.forEach((item, i) => {
    try {
      criados.push(inserir(item.nome, item.documento));
    } catch (e) {
      if (!(e instanceof ErroDeUso)) throw e;
      erros.push({ linha: i + 1, nome: item.nome, documento: item.documento, erro: e.message });
    }
  });
  if (criados.length) varrerEntradas(criados.map((c) => c.id));
  return { criados, erros };
}

/** Remove (exclusão lógica) e apaga as ocorrências dela. */
export function remover(id: number): void {
  const r = db().prepare('UPDATE blacklist_entradas SET excluido_em = ? WHERE id = ? AND excluido_em IS NULL').run(agora(), id);
  if (!r.changes) throw new ErroDeUso('Entrada não encontrada.', 404);
  db().prepare('DELETE FROM blacklist_ocorrencias WHERE entrada_id = ?').run(id);
}

// ---------------------------------------------------------------------------
// Varredura
// ---------------------------------------------------------------------------

/** Transação que funciona também dentro da transação de quem chamou (o Upload Base). */
function emTransacao<T>(fn: () => T): T {
  return db().isTransaction ? fn() : transacao(fn);
}

type Achado = { entrada_id: number; base_id: string; titulo_id: number; papel: 'cedente' | 'sacado' };

/** Procura as entradas nos documentos de cedente e sacado dos títulos (de uma base ou de todas). */
function procurar(entradas: LinhaEntrada[], baseId: string | null): Achado[] {
  if (!entradas.length) return [];
  const porDoc = new Map(entradas.map((e) => [e.documento, e.id]));
  const consulta = baseId
    ? db().prepare('SELECT id, base_id, cedente_documento, sacado_documento FROM titulos WHERE base_id = ?').iterate(baseId)
    : db().prepare('SELECT id, base_id, cedente_documento, sacado_documento FROM titulos').iterate();
  const achados: Achado[] = [];
  for (const t of consulta as Iterable<{ id: number; base_id: string; cedente_documento: string | null; sacado_documento: string | null }>) {
    const ced = porDoc.get(normalizarDocumento(t.cedente_documento));
    if (ced !== undefined) achados.push({ entrada_id: ced, base_id: t.base_id, titulo_id: t.id, papel: 'cedente' });
    const sac = porDoc.get(normalizarDocumento(t.sacado_documento));
    if (sac !== undefined) achados.push({ entrada_id: sac, base_id: t.base_id, titulo_id: t.id, papel: 'sacado' });
  }
  return achados;
}

function gravar(achados: Achado[], basesVarridas: string[]): number {
  return emTransacao(() => {
    const ts = agora();
    const ins = db().prepare('INSERT OR IGNORE INTO blacklist_ocorrencias (entrada_id, base_id, titulo_id, papel, detectado_em) VALUES (?, ?, ?, ?, ?)');
    let novas = 0;
    for (const a of achados) novas += Number(ins.run(a.entrada_id, a.base_id, a.titulo_id, a.papel, ts).changes);
    const marca = db().prepare('INSERT INTO blacklist_varreduras (base_id, varrida_em) VALUES (?, ?) ON CONFLICT(base_id) DO UPDATE SET varrida_em = excluded.varrida_em');
    for (const b of basesVarridas) marca.run(b, ts);
    return novas;
  });
}

/** Procura as entradas ativas da BlackList nos títulos da base e grava as ocorrências. Nunca derruba quem chamou. */
export function varrerBase(baseId: string): { ocorrencias: number } {
  try {
    const existe = db().prepare('SELECT 1 FROM bases WHERE id = ?').get(baseId);
    if (!existe) return { ocorrencias: 0 };
    return { ocorrencias: gravar(procurar(ativas(), baseId), [baseId]) };
  } catch (e) {
    console.error('BlackList: varredura da base falhou', baseId, e);
    return { ocorrencias: 0 };
  }
}

/** Primeira varredura de entradas recém-cadastradas: todas as bases. */
function varrerEntradas(ids: number[]): number {
  const entradas = ativas().filter((e) => ids.includes(e.id));
  const novas = gravar(procurar(entradas, null), []);
  const ts = agora();
  const marca = db().prepare('UPDATE blacklist_entradas SET varredura_em = ? WHERE id = ?');
  for (const id of ids) marca.run(ts, id);
  return novas;
}

/** "Reprocessar": todas as entradas ativas contra todas as bases. */
export function reprocessar(): { ocorrencias: number } {
  const bases = (db().prepare('SELECT id FROM bases').all() as { id: string }[]).map((b) => b.id);
  const novas = gravar(procurar(ativas(), null), bases);
  db().prepare('UPDATE blacklist_entradas SET varredura_em = ? WHERE excluido_em IS NULL').run(agora());
  return { ocorrencias: novas };
}

/** Bases que entraram sem passar pela varredura (outro caminho de importação). */
function varrerBasesNovas(): void {
  const pendentes = db().prepare('SELECT b.id FROM bases b LEFT JOIN blacklist_varreduras v ON v.base_id = b.id WHERE v.base_id IS NULL').all() as { id: string }[];
  if (!pendentes.length) return;
  const entradas = ativas();
  const achados = pendentes.flatMap((b) => procurar(entradas, b.id));
  gravar(achados, pendentes.map((b) => b.id));
}

// ---------------------------------------------------------------------------
// Leitura
// ---------------------------------------------------------------------------

type BaseTotais = {
  base_id: string;
  fundo_chave: string;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  data_referencia: string | null;
  criado_em: string;
  total_linhas: number;
  total_nominal: number;
  total_aquisicao: number;
};

/** Totais de cada base (denominador dos percentuais) e a chave do fundo: CNPJ só dígitos, senão o nome. */
function totaisDasBases(ids?: string[]): Map<string, BaseTotais> {
  const filtro = ids ? `WHERE b.id IN (${ids.map(() => '?').join(',') || "''"})` : '';
  const linhas = db().prepare(`
    SELECT b.id AS base_id, COALESCE(f.nome, b.nome_fundo) AS nome_fundo, COALESCE(f.cnpj, b.cnpj_fundo) AS cnpj_fundo,
           b.data_referencia, b.criado_em,
           (SELECT COUNT(*) FROM titulos t WHERE t.base_id = b.id) AS total_linhas,
           (SELECT COALESCE(SUM(CAST(t.valor_total AS REAL)), 0) FROM titulos t WHERE t.base_id = b.id) AS total_nominal,
           (SELECT COALESCE(SUM(CAST(t.valor_aquisicao AS REAL)), 0) FROM titulos t WHERE t.base_id = b.id) AS total_aquisicao
      FROM bases b LEFT JOIN fundos f ON f.id = b.fundo_id ${filtro}`).all(...(ids ?? [])) as Omit<BaseTotais, 'fundo_chave'>[];
  return new Map(linhas.map((l) => [l.base_id, {
    ...l, fundo_chave: digitos(l.cnpj_fundo) || (l.nome_fundo ?? '').trim().toUpperCase() || 'SEM_FUNDO',
  }]));
}

/** Base mais recente de cada fundo (por data de referência, depois criação). */
function basesMaisRecentes(): Map<string, BaseTotais> {
  const melhor = new Map<string, BaseTotais>();
  for (const b of totaisDasBases().values()) {
    const atual = melhor.get(b.fundo_chave);
    const chaveOrdem = (x: BaseTotais) => `${x.data_referencia ?? ''}|${x.criado_em}`;
    if (!atual || chaveOrdem(b) > chaveOrdem(atual)) melhor.set(b.fundo_chave, b);
  }
  return new Map([...melhor.values()].map((b) => [b.base_id, b]));
}

type Agregado = {
  entrada_id: number; base_id: string; linhas: number; linhas_cedente: number; linhas_sacado: number;
  valor_nominal: number; valor_presente: number; novas_7d: number;
};

/** Ocorrências por (entrada, base); a mesma linha nos dois papéis conta uma vez nas linhas e nos valores. */
function agregar(opcoes: { bases?: string[]; entradaId?: number }): Agregado[] {
  const filtros: string[] = [];
  const params: (string | number)[] = [];
  if (opcoes.bases) {
    if (!opcoes.bases.length) return [];
    filtros.push(`o.base_id IN (${opcoes.bases.map(() => '?').join(',')})`);
    params.push(...opcoes.bases);
  }
  if (opcoes.entradaId !== undefined) {
    filtros.push('o.entrada_id = ?');
    params.push(opcoes.entradaId);
  }
  const semana = new Date(Date.now() - 7 * 86_400_000).toISOString();
  return db().prepare(`
    WITH por_linha AS (
      SELECT o.entrada_id, o.base_id, o.titulo_id,
             MAX(o.papel = 'cedente') AS ced, MAX(o.papel = 'sacado') AS sac, MIN(o.detectado_em) AS detectado_em
        FROM blacklist_ocorrencias o ${filtros.length ? `WHERE ${filtros.join(' AND ')}` : ''}
       GROUP BY o.entrada_id, o.base_id, o.titulo_id
    )
    SELECT l.entrada_id, l.base_id, COUNT(*) AS linhas,
           SUM(l.ced) AS linhas_cedente, SUM(l.sac) AS linhas_sacado,
           COALESCE(SUM(CAST(t.valor_total AS REAL)), 0) AS valor_nominal,
           COALESCE(SUM(CAST(t.valor_aquisicao AS REAL)), 0) AS valor_presente,
           SUM(CASE WHEN e.varredura_em IS NOT NULL AND l.detectado_em > e.varredura_em AND l.detectado_em > ? THEN 1 ELSE 0 END) AS novas_7d
      FROM por_linha l
      JOIN titulos t ON t.id = l.titulo_id
      JOIN blacklist_entradas e ON e.id = l.entrada_id AND e.excluido_em IS NULL
     GROUP BY l.entrada_id, l.base_id`).all(...params, semana) as Agregado[];
}

const pct = (parte: number, total: number) => (total ? parte / total : 0);

export type OcorrenciaFundo = {
  fundo_chave: string;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  base_id: string;
  data_referencia: string | null;
  linhas: number;
  linhas_cedente: number;
  linhas_sacado: number;
  valor_nominal: number;
  valor_presente: number;
  total_nominal_base: number;
  total_presente_base: number;
  percentual_nominal: number;
  percentual_presente: number;
  novas_7d: number;
};

function linhaFundo(a: Agregado, b: BaseTotais): OcorrenciaFundo {
  return {
    fundo_chave: b.fundo_chave, nome_fundo: b.nome_fundo, cnpj_fundo: b.cnpj_fundo, base_id: a.base_id, data_referencia: b.data_referencia,
    linhas: a.linhas, linhas_cedente: a.linhas_cedente, linhas_sacado: a.linhas_sacado,
    valor_nominal: a.valor_nominal, valor_presente: a.valor_presente,
    total_nominal_base: b.total_nominal, total_presente_base: b.total_aquisicao,
    percentual_nominal: pct(a.valor_nominal, b.total_nominal), percentual_presente: pct(a.valor_presente, b.total_aquisicao),
    novas_7d: a.novas_7d,
  };
}

export type ResumoEntrada = {
  total_fundos: number;
  total_linhas: number;
  linhas_cedente: number;
  linhas_sacado: number;
  papeis: ('cedente' | 'sacado')[];
  valor_nominal: number;
  valor_presente: number;
  percentual_nominal: number;
  percentual_presente: number;
  novas_7d: number;
  fundos: OcorrenciaFundo[];
};

function resumoDaEntrada(fundos: OcorrenciaFundo[]): ResumoEntrada {
  const soma = (k: keyof OcorrenciaFundo) => fundos.reduce((s, f) => s + (f[k] as number), 0);
  const papeis: ('cedente' | 'sacado')[] = [];
  if (fundos.some((f) => f.linhas_cedente)) papeis.push('cedente');
  if (fundos.some((f) => f.linhas_sacado)) papeis.push('sacado');
  return {
    total_fundos: fundos.length, total_linhas: soma('linhas'), linhas_cedente: soma('linhas_cedente'), linhas_sacado: soma('linhas_sacado'),
    papeis, valor_nominal: soma('valor_nominal'), valor_presente: soma('valor_presente'),
    percentual_nominal: pct(soma('valor_nominal'), soma('total_nominal_base')),
    percentual_presente: pct(soma('valor_presente'), soma('total_presente_base')),
    novas_7d: soma('novas_7d'),
    fundos: [...fundos].sort((a, b) => b.valor_nominal - a.valor_nominal || (a.nome_fundo ?? '').localeCompare(b.nome_fundo ?? '')),
  };
}

export type EntradaComOcorrencias = Entrada & { ocorrencias: ResumoEntrada };

/** Entradas ativas, cada uma com as ocorrências na base mais recente de cada fundo. */
export function listar(): EntradaComOcorrencias[] {
  varrerBasesNovas();
  const recentes = basesMaisRecentes();
  const porEntrada = new Map<number, OcorrenciaFundo[]>();
  for (const a of agregar({ bases: [...recentes.keys()] })) {
    const b = recentes.get(a.base_id);
    if (!b) continue;
    if (!porEntrada.has(a.entrada_id)) porEntrada.set(a.entrada_id, []);
    porEntrada.get(a.entrada_id)!.push(linhaFundo(a, b));
  }
  return ativas().map((e) => ({ ...entrada(e), ocorrencias: resumoDaEntrada(porEntrada.get(e.id) ?? []) }))
    .sort((a, b) => b.ocorrencias.valor_nominal - a.ocorrencias.valor_nominal || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Todas as bases (não só a mais recente) em que a entidade aparece. */
export function historico(id: number): Entrada & { bases: OcorrenciaFundo[] } {
  const [e] = ativas(id);
  if (!e) throw new ErroDeUso('Entrada não encontrada.', 404);
  const agregados = agregar({ entradaId: id });
  const bases = totaisDasBases(agregados.map((a) => a.base_id));
  const linhas = agregados.filter((a) => bases.has(a.base_id)).map((a) => linhaFundo(a, bases.get(a.base_id)!))
    .sort((a, b) => (a.nome_fundo ?? '').localeCompare(b.nome_fundo ?? '') || (a.data_referencia ?? '').localeCompare(b.data_referencia ?? ''));
  return { ...entrada(e), bases: linhas };
}

/** Entidades monitoradas encontradas na base (para o aviso do Upload Base). Só lê. */
export function alertaDaBase(baseId: string): AlertaBlackList[] {
  try {
    const nomes = new Map(ativas().map((e) => [e.id, e]));
    if (!nomes.size) return [];
    const total = totaisDasBases([baseId]).get(baseId);
    const linhas = db().prepare(`
      SELECT o.entrada_id, o.papel, COUNT(*) AS linhas,
             COALESCE(SUM(CAST(t.valor_total AS REAL)), 0) AS valor_nominal,
             COALESCE(SUM(CAST(t.valor_aquisicao AS REAL)), 0) AS valor_aquisicao
        FROM blacklist_ocorrencias o JOIN titulos t ON t.id = o.titulo_id
       WHERE o.base_id = ? GROUP BY o.entrada_id, o.papel`).all(baseId) as { entrada_id: number; papel: 'cedente' | 'sacado'; linhas: number; valor_nominal: number; valor_aquisicao: number }[];
    return linhas.filter((l) => nomes.has(l.entrada_id)).map((l) => {
      const e = nomes.get(l.entrada_id)!;
      return {
        entrada_id: l.entrada_id, nome: e.nome, documento: formatarCpfCnpj(e.documento), papel: l.papel, linhas: l.linhas,
        valor_nominal: l.valor_nominal, valor_aquisicao: l.valor_aquisicao, percentual_nominal: pct(l.valor_nominal, total?.total_nominal ?? 0),
      };
    }).sort((a, b) => b.valor_nominal - a.valor_nominal);
  } catch (e) {
    console.error('BlackList: alerta da base falhou', baseId, e);
    return [];
  }
}

export type ResumoBlackListRelatorio = {
  verificado: boolean;
  entidades_monitoradas: number;
  total_ocorrencias: number;
  total_linhas: number;
  texto: string;
  itens: { nome: string; documento: string; papel: string; quantidade: number; valor_nominal: number; valor_presente: number; percentual_nominal: number; percentual_presente: number }[];
};

/**
 * Quadro "Monitoramento de lista restritiva (BlackList)" do relatório NIX (resumo_para_base do
 * Bate Lastro). Varre a base antes de ler: o relatório não depende da varredura do upload.
 */
export function resumoParaRelatorio(baseId: string | null): ResumoBlackListRelatorio {
  if (!baseId) {
    return { verificado: false, entidades_monitoradas: 0, total_ocorrencias: 0, total_linhas: 0, itens: [], texto: 'Verificação de BlackList não aplicável: sem base de auditoria.' };
  }
  varrerBase(baseId);
  const entradas = ativas();
  if (!entradas.length) {
    return { verificado: true, entidades_monitoradas: 0, total_ocorrencias: 0, total_linhas: 0, itens: [], texto: 'Não há entidades cadastradas na BlackList para monitoramento.' };
  }
  const base = totaisDasBases([baseId]).get(baseId);
  const porEntrada = new Map(agregar({ bases: [baseId] }).map((a) => [a.entrada_id, a]));
  const itens = base ? entradas.flatMap((e) => {
    const a = porEntrada.get(e.id);
    if (!a) return [];
    const f = linhaFundo(a, base);
    const papel = [f.linhas_cedente ? 'Cedente' : '', f.linhas_sacado ? 'Sacado' : ''].filter(Boolean).join(' / ');
    return [{
      nome: e.nome, documento: formatarCpfCnpj(e.documento), papel, quantidade: f.linhas, valor_nominal: f.valor_nominal,
      valor_presente: f.valor_presente, percentual_nominal: f.percentual_nominal, percentual_presente: f.percentual_presente,
    }];
  }).sort((x, y) => y.valor_nominal - x.valor_nominal) : [];
  const totalLinhas = itens.reduce((s, i) => s + i.quantidade, 0);
  return {
    verificado: true, entidades_monitoradas: entradas.length, total_ocorrencias: itens.length, total_linhas: totalLinhas, itens,
    texto: itens.length
      ? `Foram identificadas ${itens.length} de ${entradas.length} entidades monitoradas na BlackList, em ${totalLinhas} linhas da base, conforme quadro abaixo.`
      : `Nenhuma das ${entradas.length} entidades monitoradas na BlackList foi identificada como cedente ou sacado na base.`,
  };
}
