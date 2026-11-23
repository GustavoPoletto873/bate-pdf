import { db, emBlocos, transacao, type Banco, type Valor } from '@/lib/db';
import { camposDoLado, type CampoId, type Lado, type TituloAmostra, type Veredito } from '@/lib/campos';
import {
  avaliarConfiabilidade, ladoDaLeitura, vereditosDoLado,
  type Confiabilidade, type LeituraCampos,
} from '@/lib/bates/comparacao';
import { camposDaLeitura, COLUNAS_LEITURA, type LeituraLinha } from '@/lib/bates/leituras';
import { podeProcessar, type MotivoProcessar } from '@/lib/bates/processar';

/**
 * Gestão de Bates: pré-bates (routes/get/pre_match.py, routes/post/pre_match_v2.py), os
 * cartões de estatística (PreMatchStats) e a área de pendências.
 */

const agora = () => new Date().toISOString();

export const COLUNAS_TITULO = `t.id AS t_id, t.id_base_origem AS t_id_base_origem, t.numero_documento AS t_numero_documento,
  t.sacado_nome AS t_sacado_nome, t.sacado_documento AS t_sacado_documento, t.cedente_nome AS t_cedente_nome,
  t.cedente_documento AS t_cedente_documento, t.valor_total AS t_valor_total, t.valor_aquisicao AS t_valor_aquisicao,
  t.data_emissao AS t_data_emissao, t.data_vencimento AS t_data_vencimento, t.data_aquisicao AS t_data_aquisicao,
  t.nome_fundo AS t_nome_fundo, t.cnpj_fundo AS t_cnpj_fundo, t.tipo_recebivel AS t_tipo_recebivel, t.chave_nfe AS t_chave_nfe`;

export type TituloDaBase = TituloAmostra & { id: number; id_base_origem: number | null };

/** Separa as colunas t_* (título) de uma linha com COLUNAS_TITULO. */
export function tituloDaLinha(r: Record<string, unknown>): TituloDaBase {
  const t: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) if (k.startsWith('t_')) t[k.slice(2)] = v;
  return t as TituloDaBase;
}

// ---------------------------------------------------------------------------
// Lista de pré-bates
// ---------------------------------------------------------------------------

export type LadoPreBate = {
  numero_documento: string | null;
  nome_cedente: string | null;
  doc_cedente: string | null;
  nome_sacado: string | null;
  doc_sacado: string | null;
  valor_nominal: string | null;
  data_vencimento: string | null;
  tipo_recebivel: string | null;
};

export type CampoComparado = { campo: CampoId; base: string | null; leitura: string | null; veredito: Veredito };

export type PreBate = {
  pre_match_id: number;
  pendencia_id: number;
  titulo_id: number;
  lado: Lado;
  tipo_validacao: 'TERMO' | 'LASTRO';
  similaridade: number;
  criterio: number | null;
  criado_em: string;
  base: LadoPreBate & { id_base_origem: number | null };
  leitura: LadoPreBate & { id: number; pdf_id: number | null; pdf_nome: string | null; origem: string };
  confiabilidade: Confiabilidade;
  /** Campo a campo (só nos itens da página pedida). */
  campos?: CampoComparado[];
};

type LinhaPreBate = {
  pre_match_id: number;
  pendencia_id: number;
  lado: Lado;
  similaridade: number;
  criterio: number | null;
  criado_em: string;
  pdf_nome: string | null;
} & Record<string, unknown>;

async function carregarPreBates(conexao: Banco, baseId: string, ids?: number[]): Promise<{ pre: PreBate; titulo: TituloDaBase; leitura: LeituraLinha }[]> {
  // Com ids, em blocos (IN com muitos ids passa do limite de parâmetros).
  const grupos: (number[] | undefined)[] = ids?.length ? emBlocos(ids) : [undefined];
  const linhas: LinhaPreBate[] = [];
  for (const grupo of grupos) {
  const filtro = grupo ? `AND pm.id IN (${grupo.map(() => '?').join(',')})` : '';
  linhas.push(...await conexao.prepare(`
    SELECT pm.id AS pre_match_id, pm.pendencia_id, p.lado, pm.similaridade, pm.criterio, pm.criado_em,
      d.nome_arquivo AS pdf_nome, ${COLUNAS_TITULO}, ${COLUNAS_LEITURA}
    FROM pre_matches pm
    JOIN pendencias p ON p.id = pm.pendencia_id
    JOIN titulos t ON t.id = p.titulo_id
    JOIN leituras l ON l.id = pm.leitura_id
    LEFT JOIN pdfs d ON d.id = l.pdf_id
    WHERE pm.base_id = ? ${filtro}
    ORDER BY pm.id`).all<LinhaPreBate>(baseId, ...(grupo ?? [])));
  }
  return linhas.map((r) => {
    const titulo = tituloDaLinha(r);
    const leitura: LeituraLinha = {
      id: r.id as number, base_id: r.base_id as string, pdf_id: r.pdf_id as number | null, tipo_recebivel: r.tipo_recebivel as string | null,
      numero_documento: r.numero_documento as string | null, sacado_nome: r.sacado_nome as string | null,
      sacado_documento: r.sacado_documento as string | null, cedente_nome: r.cedente_nome as string | null,
      cedente_documento: r.cedente_documento as string | null, cessionario_nome: r.cessionario_nome as string | null,
      cessionario_documento: r.cessionario_documento as string | null, valor_nominal: r.valor_nominal as string | null,
      data_aquisicao: r.data_aquisicao as string | null, data_emissao: r.data_emissao as string | null,
      data_vencimento: r.data_vencimento as string | null, origem: r.origem as string, lida_em: r.lida_em as string,
    };
    const base = {
      numero_documento: titulo.numero_documento, nome_cedente: titulo.cedente_nome, doc_cedente: titulo.cedente_documento,
      nome_sacado: titulo.sacado_nome, doc_sacado: titulo.sacado_documento, valor_nominal: titulo.valor_total,
      data_vencimento: titulo.data_vencimento, tipo_recebivel: titulo.tipo_recebivel, id_base_origem: titulo.id_base_origem,
    };
    const lidaTela = {
      id: leitura.id, numero_documento: leitura.numero_documento, nome_cedente: leitura.cedente_nome, doc_cedente: leitura.cedente_documento,
      nome_sacado: leitura.sacado_nome, doc_sacado: leitura.sacado_documento, valor_nominal: leitura.valor_nominal,
      data_vencimento: leitura.data_vencimento, tipo_recebivel: leitura.tipo_recebivel, pdf_id: leitura.pdf_id,
      pdf_nome: r.pdf_nome, origem: leitura.origem,
    };
    // Tipo pelo TIPO_RECEBIVEL da leitura, como lá (é o mesmo lado da pendência: a cascata roda por lado).
    const lado = ladoDaLeitura(leitura.tipo_recebivel);
    return {
      titulo,
      leitura,
      pre: {
        pre_match_id: r.pre_match_id, pendencia_id: r.pendencia_id, titulo_id: titulo.id, lado,
        tipo_validacao: lado === 'termo' ? 'TERMO' : 'LASTRO',
        similaridade: r.similaridade, criterio: r.criterio, criado_em: r.criado_em,
        base, leitura: lidaTela,
        confiabilidade: avaliarConfiabilidade(base, lidaTela),
      },
    };
  });
}

/** Campo a campo, com o veredito que o vínculo receberia ao confirmar. */
function compararCampos(lado: Lado, titulo: TituloDaBase, leitura: LeituraCampos): CampoComparado[] {
  const vereditos = vereditosDoLado(lado, titulo, leitura);
  return camposDoLado(lado).map((def) => {
    const b = titulo[def.campoBase];
    return { campo: def.campo, base: b === null || b === undefined ? null : String(b), leitura: leitura[def.campo] ?? null, veredito: vereditos[def.campo]! };
  });
}

export type FiltroPreBates = {
  tipo?: 'todos' | 'termo' | 'lastro';
  /** Níveis de confiabilidade (0, 20 … 100); vazio = todos. */
  confiabilidade?: number[];
  pagina?: number;
  tamanho?: number;
};

export type PaginaPreBates = {
  itens: PreBate[];
  total: number;
  pagina: number;
  tamanho: number;
  /** Quantos pré-bates por aba (sem o filtro de confiabilidade). */
  por_tipo: { todos: number; termo: number; lastro: number };
  /** Quantos por nível de confiabilidade, na aba pedida. */
  por_confiabilidade: Record<number, number>;
  /** Todos os ids que passam no filtro (para o "Selecionar Todos"). */
  ids: number[];
};

export async function listarPreBates(baseId: string, filtro: FiltroPreBates = {}): Promise<PaginaPreBates> {
  const todos = await carregarPreBates(await db(), baseId);
  const tipo = filtro.tipo ?? 'todos';
  const daAba = todos.filter((x) => tipo === 'todos' || x.pre.lado === tipo);
  const porConfiabilidade: Record<number, number> = {};
  for (const x of daAba) porConfiabilidade[x.pre.confiabilidade.percentual] = (porConfiabilidade[x.pre.confiabilidade.percentual] ?? 0) + 1;
  const niveis = filtro.confiabilidade ?? [];
  const filtrados = niveis.length ? daAba.filter((x) => niveis.includes(x.pre.confiabilidade.percentual)) : daAba;
  const tamanho = Math.min(Math.max(filtro.tamanho ?? 50, 1), 500);
  const paginas = Math.max(1, Math.ceil(filtrados.length / tamanho));
  const pagina = Math.min(Math.max(filtro.pagina ?? 1, 1), paginas);
  const itens = filtrados.slice((pagina - 1) * tamanho, pagina * tamanho).map((x) => ({
    ...x.pre,
    campos: compararCampos(x.pre.lado, x.titulo, camposDaLeitura(x.leitura, x.pre.lado)),
  }));
  return {
    itens,
    total: filtrados.length,
    pagina,
    tamanho,
    por_tipo: { todos: todos.length, termo: todos.filter((x) => x.pre.lado === 'termo').length, lastro: todos.filter((x) => x.pre.lado === 'lastro').length },
    por_confiabilidade: porConfiabilidade,
    ids: filtrados.map((x) => x.pre.pre_match_id),
  };
}

// ---------------------------------------------------------------------------
// Confirmar e rejeitar
// ---------------------------------------------------------------------------

/**
 * confirm_pre_matches: o pré-bate vira vínculo (tipo_match 'automatico', com a leitura, a
 * similaridade, o PDF da leitura e o veredito por campo da comparação) e a pendência fica
 * vinculada. Pré-bate de pendência que já foi batida por outro caminho só é descartado.
 */
export async function confirmarPreBates(baseId: string, ids: number[]): Promise<{ confirmados: number; descartados: number }> {
  if (!ids.length) return { confirmados: 0, descartados: 0 };
  let confirmados = 0;
  let descartados = 0;
  await transacao(async (tx) => {
    const itens = await carregarPreBates(tx, baseId, ids);
    // Situação de todas as pendências de uma vez; as escritas vão num lote só.
    const situacao = new Map<number, string>();
    for (const bloco of emBlocos([...new Set(itens.map((x) => x.pre.pendencia_id))])) {
      for (const r of await tx.prepare(`SELECT id, situacao FROM pendencias WHERE id IN (${bloco.map(() => '?').join(',')})`).all<{ id: number; situacao: string }>(...bloco)) {
        situacao.set(r.id, r.situacao);
      }
    }
    const ts = agora();
    const comandos: Comando[] = [];
    for (const { pre, titulo, leitura } of itens) {
      comandos.push({ sql: 'DELETE FROM pre_matches WHERE id = ?', args: [pre.pre_match_id] });
      if (situacao.get(pre.pendencia_id) !== 'pendente') { descartados++; continue; }
      comandos.push(...comandosDoVinculo({
        pendencia_id: pre.pendencia_id, lado: pre.lado, titulo, leitura,
        tipo_match: 'automatico', origem: 'pre_bate', similaridade: pre.similaridade, ts,
      }));
      // Duas confirmações da mesma pendência no lote: só a primeira vale.
      situacao.set(pre.pendencia_id, 'vinculado');
      confirmados++;
    }
    if (confirmados) comandos.push({ sql: 'UPDATE bases SET atualizado_em = ? WHERE id = ?', args: [ts, baseId] });
    for (const bloco of emBlocos(comandos, 200)) await tx.lote(bloco);
  });
  return { confirmados, descartados };
}

type Comando = { sql: string; args: Valor[] };

export type DadosVinculoDeLeitura = {
  pendencia_id: number;
  lado: Lado;
  titulo: TituloAmostra;
  leitura: Partial<LeituraLinha> & { id: number };
  tipo_match: 'automatico' | 'manual';
  origem: string;
  similaridade: number | null;
  salvas?: Partial<Record<CampoId, Veredito>>;
  ts: string;
};

/**
 * Os comandos que criam o vínculo de uma pendência com uma leitura que já existe (pré-bate
 * confirmado ou Inserir Resultado). `salvas` = vereditos que valem mais que a comparação.
 */
export function comandosDoVinculo(d: DadosVinculoDeLeitura): Comando[] {
  const campos = camposDaLeitura(d.leitura, d.lado);
  const marcacoes = vereditosDoLado(d.lado, d.titulo, campos, d.salvas);
  return [
    {
      sql: `INSERT INTO vinculos (pendencia_id, pdf_id, pagina, marcacoes, leitura, origem, usuario, criado_em, leitura_id, tipo_match, similaridade)
    VALUES (?, ?, NULL, ?, ?, ?, NULL, ?, ?, ?, ?)`,
      args: [d.pendencia_id, d.leitura.pdf_id ?? null, JSON.stringify(marcacoes), JSON.stringify(campos), d.origem, d.ts,
        d.leitura.id, d.tipo_match, d.similaridade],
    },
    { sql: "UPDATE pendencias SET situacao = 'vinculado' WHERE id = ?", args: [d.pendencia_id] },
    { sql: 'DELETE FROM pre_matches WHERE pendencia_id = ?', args: [d.pendencia_id] },
  ];
}

/** Cria o vínculo de uma pendência com uma leitura que já existe (dentro de transação, com o `tx`). */
export async function criarVinculoDeLeitura(tx: Banco, d: DadosVinculoDeLeitura) {
  await tx.lote(comandosDoVinculo(d));
}

/** reject_pre_matches: apaga o pré-bate; a pendência continua aberta e a leitura fica órfã. */
export async function rejeitarPreBates(baseId: string, ids: number[]): Promise<{ rejeitados: number }> {
  if (!ids.length) return { rejeitados: 0 };
  const comandos = emBlocos(ids).map((bloco) => ({
    sql: `DELETE FROM pre_matches WHERE base_id = ? AND id IN (${bloco.map(() => '?').join(',')})`,
    args: [baseId, ...bloco] as Valor[],
  }));
  const rs = await (await db()).lote(comandos);
  return { rejeitados: rs.reduce((a, r) => a + Number(r.changes), 0) };
}

// ---------------------------------------------------------------------------
// Cartões e pendências
// ---------------------------------------------------------------------------

export type PainelBates = {
  total_confirmados: number;
  confirmados: { automaticos: number; manuais: number; do_bate_lastro: number };
  pendentes: { termo: number; lastro: number };
  total_pre_matches: number;
  pre_matches: { termo: number; lastro: number };
  total_registros: number;
  /** Documentos lidos (PDF/XML distintos) por lado; `linhas_*` = linhas de leitura (um documento pode trazer várias parcelas). */
  leituras: { termo: number; lastro: number; orfas: number; linhas_termo: number; linhas_lastro: number };
  pode_processar: boolean;
  motivo_processar: MotivoProcessar;
};

export async function painelDaBase(baseId: string): Promise<PainelBates> {
  const c = await db();
  const um = async <T>(sql: string, ...p: (string | number)[]) => (await c.prepare(sql).get(...p)) as T;
  const vinc = await c.prepare(`SELECT v.tipo_match, COUNT(*) n FROM vinculos v JOIN pendencias p ON p.id = v.pendencia_id
    WHERE p.base_id = ? GROUP BY v.tipo_match`).all(baseId) as { tipo_match: string; n: number }[];
  const automaticos = vinc.filter((v) => v.tipo_match === 'automatico').reduce((a, v) => a + v.n, 0);
  const manuais = vinc.filter((v) => v.tipo_match !== 'automatico').reduce((a, v) => a + v.n, 0);
  const jaBatidos = (await um<{ n: number }>("SELECT COUNT(*) n FROM pendencias WHERE base_id = ? AND situacao = 'ja_batido'", baseId)).n;
  const abertas = await c.prepare(`SELECT p.lado, COUNT(*) n FROM pendencias p WHERE p.base_id = ? AND p.situacao = 'pendente'
    AND NOT EXISTS (SELECT 1 FROM pre_matches pm WHERE pm.pendencia_id = p.id) GROUP BY p.lado`).all(baseId) as { lado: Lado; n: number }[];
  const pre = await c.prepare(`SELECT p.lado, COUNT(*) n FROM pre_matches pm JOIN pendencias p ON p.id = pm.pendencia_id
    WHERE pm.base_id = ? GROUP BY p.lado`).all(baseId) as { lado: Lado; n: number }[];
  const leituras = await c.prepare(`SELECT l.id, l.pdf_id, l.documento_id, l.tipo_recebivel,
      (EXISTS (SELECT 1 FROM vinculos v WHERE v.leitura_id = l.id) OR EXISTS (SELECT 1 FROM pre_matches pm WHERE pm.leitura_id = l.id)) AS usada
    FROM leituras l WHERE l.base_id = ?`).all(baseId) as { id: number; pdf_id: number | null; documento_id: number | null; tipo_recebivel: string | null; usada: number }[];
  // Um documento conta uma vez: o do Anexo, senão o PDF, senão a própria linha (planilha/manual).
  const documentos = (lado: Lado) => new Set(leituras.filter((l) => ladoDaLeitura(l.tipo_recebivel) === lado)
    .map((l) => (l.documento_id != null ? `d${l.documento_id}` : l.pdf_id != null ? `p${l.pdf_id}` : `l${l.id}`))).size;
  const n = (lista: { lado: Lado; n: number }[], lado: Lado) => lista.find((x) => x.lado === lado)?.n ?? 0;
  const pp = await podeProcessar(baseId);
  const totalRegistros = (await um<{ n: number }>('SELECT COUNT(*) n FROM titulos WHERE base_id = ?', baseId)).n;
  return {
    total_confirmados: automaticos + manuais + jaBatidos,
    confirmados: { automaticos, manuais, do_bate_lastro: jaBatidos },
    pendentes: { termo: n(abertas, 'termo'), lastro: n(abertas, 'lastro') },
    total_pre_matches: n(pre, 'termo') + n(pre, 'lastro'),
    pre_matches: { termo: n(pre, 'termo'), lastro: n(pre, 'lastro') },
    total_registros: totalRegistros,
    leituras: {
      termo: documentos('termo'),
      lastro: documentos('lastro'),
      linhas_termo: leituras.filter((l) => ladoDaLeitura(l.tipo_recebivel) === 'termo').length,
      linhas_lastro: leituras.filter((l) => ladoDaLeitura(l.tipo_recebivel) === 'lastro').length,
      orfas: leituras.filter((l) => !l.usada).length,
    },
    pode_processar: pp.pode_processar,
    motivo_processar: pp.motivo,
  };
}

export type PendenciaAberta = {
  pendencia_id: number;
  lado: Lado;
  titulo: TituloDaBase;
};

export type LeituraOrfa = LeituraLinha & { lado: Lado; pdf_nome: string | null };

/** Títulos ainda sem documento (pendentes e sem pré-bate) e leituras sem título (órfãs). */
export async function pendenciasEOrfas(baseId: string, limite = 300): Promise<{
  pendencias: PendenciaAberta[];
  total_pendencias: { termo: number; lastro: number };
  orfas: LeituraOrfa[];
  total_orfas: number;
}> {
  const c = await db();
  const pend = await c.prepare(`SELECT p.id AS pendencia_id, p.lado, ${COLUNAS_TITULO}
    FROM pendencias p JOIN titulos t ON t.id = p.titulo_id
    WHERE p.base_id = ? AND p.situacao = 'pendente' AND NOT EXISTS (SELECT 1 FROM pre_matches pm WHERE pm.pendencia_id = p.id)
    ORDER BY p.lado DESC, t.id`).all(baseId) as ({ pendencia_id: number; lado: Lado } & Record<string, unknown>)[];
  const orfas = await c.prepare(`SELECT ${COLUNAS_LEITURA}, d.nome_arquivo AS pdf_nome FROM leituras l LEFT JOIN pdfs d ON d.id = l.pdf_id
    WHERE l.base_id = ? AND NOT EXISTS (SELECT 1 FROM vinculos v WHERE v.leitura_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM pre_matches pm WHERE pm.leitura_id = l.id)
    ORDER BY l.id`).all(baseId) as (LeituraLinha & { pdf_nome: string | null })[];
  const termo = pend.filter((p) => p.lado === 'termo');
  const lastro = pend.filter((p) => p.lado === 'lastro');
  const corte = (lista: typeof pend) => lista.slice(0, limite).map((p) => ({ pendencia_id: p.pendencia_id, lado: p.lado, titulo: tituloDaLinha(p) }));
  return {
    pendencias: [...corte(termo), ...corte(lastro)],
    total_pendencias: { termo: termo.length, lastro: lastro.length },
    orfas: orfas.slice(0, limite).map((l) => ({ ...l, lado: ladoDaLeitura(l.tipo_recebivel) })),
    total_orfas: orfas.length,
  };
}
