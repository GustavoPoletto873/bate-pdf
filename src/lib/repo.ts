import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { db, pastaDePdfs, transacao } from '@/lib/db';
import {
  camposDoLado, camposEmP, valorDaLeitura,
  type CampoId, type Lado, type TituloAmostra, type Veredito,
} from '@/lib/campos';
import { normalizarTexto } from '@/lib/texto';
import { ErroDeUso } from '@/lib/api';
import type { TituloImportado } from '@/lib/planilha/importar';
import type { LinhaExportacao } from '@/lib/planilha/exportar';
import { inserirLeitura, tipoRecebivelDoLado } from '@/lib/bates/leituras';
import { linhasDaExportacao } from '@/lib/bates/resultados';

/**
 * Acesso a dados do app. Funções síncronas (node:sqlite é síncrono); as rotas
 * da API chamam daqui.
 */

const agora = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Tipos que a API devolve
// ---------------------------------------------------------------------------

export type Base = {
  id: string;
  nome: string;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  data_referencia: string | null;
  administradora: string | null;
  origem: 'resultados_matching' | 'amostra';
  arquivo_origem: string | null;
  /** Fundo cadastrado em Gestão › Fundos (null em bases antigas ou importadas sem fundo). */
  fundo_id: number | null;
  /** 'TRIMESTRE' (guarda o último dia do trimestre) ou 'DATA_REFERENCIA' (a data exata), como no Bate Lastro. */
  modo_referencia: 'TRIMESTRE' | 'DATA_REFERENCIA';
  /** Auditoria finalizada (Resultados › Marcar como finalizada). */
  finalizada: number;
  finalizada_em: string | null;
  criado_em: string;
  atualizado_em: string;
};

export type BaseResumo = Base & {
  titulos: number;
  pendentes: { termo: number; lastro: number };
  vinculados: { termo: number; lastro: number };
  ja_batidos: number;
  pdfs: { total: number; indexados: number; pendentes: number; sem_texto: number; falhos: number };
  pre_classificado_em: string | null;
};

export type Titulo = TituloAmostra & { id: number; linha_origem: number | null; id_base_origem: number | null };

export type MarcacaoCampo = { valor: Veredito; valor_digitado: string | null; origem: string };

export type Vinculo = {
  id: number;
  pdf_id: number | null;
  pdf_nome: string | null;
  pagina: number | null;
  marcacoes: Partial<Record<CampoId, Veredito>>;
  leitura: Partial<Record<CampoId, string | null>>;
  origem: string;
  criado_em: string;
  /** 'manual' (Bater PDF, conferência, planilha) | 'automatico' (pré-bate confirmado). */
  tipo_match: string;
  leitura_id: number | null;
  similaridade: number | null;
};

/** Pré-bate do "Processar Base" para a pendência (confirmado/rejeitado na Gestão de Bates). */
export type PreBateDaPendencia = {
  id: number;
  leitura_id: number;
  similaridade: number;
  criterio: number | null;
  numero_documento: string | null;
  pdf_id: number | null;
  pdf_nome: string | null;
};

export type PendenciaLinha = {
  pendencia_id: number;
  titulo_id: number;
  lado: Lado;
  situacao: 'pendente' | 'vinculado' | 'ja_batido';
  titulo: Titulo;
  marcacoes: Partial<Record<CampoId, MarcacaoCampo>>;
  vinculo: Vinculo | null;
  pre_bate: PreBateDaPendencia | null;
};

export type PdfInfo = {
  id: number;
  nome_arquivo: string;
  caminho_relativo: string | null;
  sha256: string;
  tamanho: number;
  total_paginas: number | null;
  paginas_com_texto: number | null;
  status: string;
  erro: string | null;
  tipo_declarado: Lado | null;
  vinculos: number;
};

// ---------------------------------------------------------------------------
// Bases
// ---------------------------------------------------------------------------

export function criarBase(dados: {
  nome: string;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  data_referencia: string | null;
  administradora: string | null;
  origem: Base['origem'];
  arquivo_origem: string | null;
  titulos: TituloImportado[];
  /** Na amostra, quais lados nascem pendentes. */
  lados?: Lado[];
  fundo_id?: number | null;
  modo_referencia?: Base['modo_referencia'];
}): string {
  const id = randomUUID();
  const c = db();
  transacao(() => {
    const ts = agora();
    c.prepare(`INSERT INTO bases (id, nome, nome_fundo, cnpj_fundo, data_referencia, administradora, origem, arquivo_origem,
               fundo_id, modo_referencia, criado_em, atualizado_em)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, dados.nome, dados.nome_fundo, dados.cnpj_fundo, dados.data_referencia, dados.administradora,
        dados.origem, dados.arquivo_origem, dados.fundo_id ?? null, dados.modo_referencia ?? 'DATA_REFERENCIA', ts, ts);
    const insTitulo = c.prepare(`INSERT INTO titulos (base_id, linha_origem, id_base_origem, numero_documento, sacado_nome,
        sacado_documento, cedente_nome, cedente_documento, valor_total, valor_aquisicao, data_emissao, data_vencimento,
        data_aquisicao, nome_fundo, cnpj_fundo, tipo_recebivel, chave_nfe)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const insPend = c.prepare('INSERT INTO pendencias (base_id, titulo_id, lado, situacao) VALUES (?, ?, ?, ?)');
    for (const t of dados.titulos) {
      const r = insTitulo.run(id, t.linha_origem, t.id_base_origem, t.numero_documento, t.sacado_nome,
        t.sacado_documento, t.cedente_nome, t.cedente_documento, t.valor_total, t.valor_aquisicao, t.data_emissao,
        t.data_vencimento, t.data_aquisicao, t.nome_fundo ?? dados.nome_fundo, t.cnpj_fundo ?? dados.cnpj_fundo,
        t.tipo_recebivel, t.chave_nfe);
      const tituloId = Number(r.lastInsertRowid);
      for (const lado of ['termo', 'lastro'] as Lado[]) {
        let situacao = t.lados[lado];
        if (dados.origem === 'amostra') {
          // Amostra: nasce pendente em cada lado escolhido (sem escolha, nos dois).
          const conferir = dados.lados ? dados.lados.includes(lado) : true;
          situacao = conferir ? 'pendente' : undefined;
        }
        if (situacao) insPend.run(id, tituloId, lado, situacao);
      }
    }
  });
  return id;
}

export function listarBases(): BaseResumo[] {
  const ids = db().prepare('SELECT id FROM bases ORDER BY atualizado_em DESC').all() as { id: string }[];
  return ids.map((r) => obterBase(r.id)!).filter(Boolean);
}

export function obterBase(id: string): BaseResumo | null {
  const c = db();
  const base = c.prepare('SELECT * FROM bases WHERE id = ?').get(id) as Base | undefined;
  if (!base) return null;
  const titulos = (c.prepare('SELECT COUNT(*) n FROM titulos WHERE base_id = ?').get(id) as { n: number }).n;
  const pend = c.prepare('SELECT lado, situacao, COUNT(*) n FROM pendencias WHERE base_id = ? GROUP BY lado, situacao').all(id) as
    { lado: Lado; situacao: string; n: number }[];
  const conta = (lado: Lado, situacao: string) => pend.find((p) => p.lado === lado && p.situacao === situacao)?.n ?? 0;
  const pdfs = c.prepare('SELECT status, COUNT(*) n FROM pdfs WHERE base_id = ? GROUP BY status').all(id) as { status: string; n: number }[];
  const contaPdf = (s: string[]) => pdfs.filter((p) => s.includes(p.status)).reduce((a, p) => a + p.n, 0);
  const pre = c.prepare('SELECT executado_em FROM pre_classificacoes WHERE base_id = ?').get(id) as { executado_em: string } | undefined;
  return {
    ...base,
    titulos,
    pendentes: { termo: conta('termo', 'pendente'), lastro: conta('lastro', 'pendente') },
    vinculados: { termo: conta('termo', 'vinculado'), lastro: conta('lastro', 'vinculado') },
    ja_batidos: conta('termo', 'ja_batido') + conta('lastro', 'ja_batido'),
    pdfs: {
      total: contaPdf(['pendente', 'indexando', 'indexado', 'sem_texto', 'falhou']),
      indexados: contaPdf(['indexado']),
      pendentes: contaPdf(['pendente', 'indexando']),
      sem_texto: contaPdf(['sem_texto']),
      falhos: contaPdf(['falhou']),
    },
    pre_classificado_em: pre?.executado_em ?? null,
  };
}

export function atualizarBase(id: string, campos: Partial<Pick<Base, 'nome' | 'nome_fundo' | 'cnpj_fundo' | 'data_referencia' | 'administradora'>>) {
  const permitidos = ['nome', 'nome_fundo', 'cnpj_fundo', 'data_referencia', 'administradora'] as const;
  const sets: string[] = [];
  const valores: (string | null)[] = [];
  for (const k of permitidos) {
    if (k in campos) { sets.push(`${k} = ?`); valores.push((campos[k] ?? null) as string | null); }
  }
  if (!sets.length) return;
  db().prepare(`UPDATE bases SET ${sets.join(', ')}, atualizado_em = ? WHERE id = ?`).run(...valores, agora(), id);
}

export function tocarBase(id: string) {
  db().prepare('UPDATE bases SET atualizado_em = ? WHERE id = ?').run(agora(), id);
}

export function excluirBase(id: string) {
  db().prepare('DELETE FROM bases WHERE id = ?').run(id);
  rmSync(pastaDePdfs(id), { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Pendências e marcações
// ---------------------------------------------------------------------------

const COLUNAS_TITULO = `t.id, t.linha_origem, t.id_base_origem, t.numero_documento, t.sacado_nome, t.sacado_documento,
  t.cedente_nome, t.cedente_documento, t.valor_total, t.valor_aquisicao, t.data_emissao, t.data_vencimento,
  t.data_aquisicao, t.nome_fundo, t.cnpj_fundo, t.tipo_recebivel, t.chave_nfe`;

export function listarPendencias(baseId: string, filtro?: { pendenciaIds?: number[] }): PendenciaLinha[] {
  const c = db();
  const onde = filtro?.pendenciaIds?.length
    ? `AND p.id IN (${filtro.pendenciaIds.map(() => '?').join(',')})`
    : '';
  const linhas = c.prepare(`
    SELECT p.id AS pendencia_id, p.lado, p.situacao, ${COLUNAS_TITULO}
    FROM pendencias p JOIN titulos t ON t.id = p.titulo_id
    WHERE p.base_id = ? ${onde}
    ORDER BY t.id, p.lado DESC
  `).all(baseId, ...(filtro?.pendenciaIds ?? [])) as (Titulo & { pendencia_id: number; lado: Lado; situacao: PendenciaLinha['situacao'] })[];

  const marcacoes = new Map<number, Partial<Record<CampoId, MarcacaoCampo>>>();
  for (const m of c.prepare(`SELECT m.pendencia_id, m.campo, m.valor, m.valor_digitado, m.origem FROM marcacoes m
      JOIN pendencias p ON p.id = m.pendencia_id WHERE p.base_id = ?`).all(baseId) as
      { pendencia_id: number; campo: CampoId; valor: Veredito; valor_digitado: string | null; origem: string }[]) {
    const atual = marcacoes.get(m.pendencia_id) ?? {};
    atual[m.campo] = { valor: m.valor, valor_digitado: m.valor_digitado, origem: m.origem };
    marcacoes.set(m.pendencia_id, atual);
  }
  const vinculos = new Map<number, Vinculo>();
  for (const v of c.prepare(`SELECT v.id, v.pendencia_id, v.pdf_id, d.nome_arquivo AS pdf_nome, v.pagina, v.marcacoes, v.leitura,
      v.origem, v.criado_em, v.tipo_match, v.leitura_id, v.similaridade FROM vinculos v JOIN pendencias p ON p.id = v.pendencia_id
      LEFT JOIN pdfs d ON d.id = v.pdf_id WHERE p.base_id = ?`).all(baseId) as
      (Omit<Vinculo, 'marcacoes' | 'leitura'> & { pendencia_id: number; marcacoes: string; leitura: string })[]) {
    vinculos.set(v.pendencia_id, { ...v, marcacoes: JSON.parse(v.marcacoes), leitura: JSON.parse(v.leitura) });
  }
  const preBates = new Map<number, PreBateDaPendencia>();
  for (const pm of c.prepare(`SELECT pm.pendencia_id, pm.id, pm.leitura_id, pm.similaridade, pm.criterio, l.numero_documento, l.pdf_id,
      d.nome_arquivo AS pdf_nome FROM pre_matches pm JOIN leituras l ON l.id = pm.leitura_id LEFT JOIN pdfs d ON d.id = l.pdf_id
      WHERE pm.base_id = ?`).all(baseId) as (PreBateDaPendencia & { pendencia_id: number })[]) {
    const { pendencia_id, ...resto } = pm;
    preBates.set(pendencia_id, resto);
  }
  return linhas.map((l) => {
    const { pendencia_id, lado, situacao, ...titulo } = l;
    return {
      pendencia_id, titulo_id: titulo.id, lado, situacao, titulo,
      marcacoes: marcacoes.get(pendencia_id) ?? {},
      vinculo: vinculos.get(pendencia_id) ?? null,
      pre_bate: preBates.get(pendencia_id) ?? null,
    };
  });
}

export type OperacaoMarcacao = {
  pendencia_id: number;
  campo: CampoId;
  /** null apaga a marcação (volta a "não decidido"). */
  valor: Veredito | null;
  valor_digitado?: string | null;
  origem?: string;
};

/** Grava V/D/P em lote. Devolve o estado anterior de cada campo (para o "desfazer"). */
export function salvarMarcacoes(baseId: string, ops: OperacaoMarcacao[]) {
  const c = db();
  const anteriores: OperacaoMarcacao[] = [];
  transacao(() => {
    const daBase = c.prepare('SELECT 1 FROM pendencias WHERE id = ? AND base_id = ?');
    const ler = c.prepare('SELECT valor, valor_digitado, origem FROM marcacoes WHERE pendencia_id = ? AND campo = ?');
    const gravar = c.prepare(`INSERT INTO marcacoes (pendencia_id, campo, valor, valor_digitado, origem, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(pendencia_id, campo) DO UPDATE SET
      valor = excluded.valor, valor_digitado = excluded.valor_digitado, origem = excluded.origem, atualizado_em = excluded.atualizado_em`);
    const apagar = c.prepare('DELETE FROM marcacoes WHERE pendencia_id = ? AND campo = ?');
    const ts = agora();
    for (const op of ops) {
      if (!daBase.get(op.pendencia_id, baseId)) throw new Error(`Pendência ${op.pendencia_id} não é desta base.`);
      const antes = ler.get(op.pendencia_id, op.campo) as { valor: Veredito; valor_digitado: string | null; origem: string } | undefined;
      anteriores.push({ pendencia_id: op.pendencia_id, campo: op.campo, valor: antes?.valor ?? null, valor_digitado: antes?.valor_digitado ?? null, origem: antes?.origem });
      if (op.valor === null) apagar.run(op.pendencia_id, op.campo);
      else gravar.run(op.pendencia_id, op.campo, op.valor, op.valor === 'D' ? (op.valor_digitado ?? null) : null, op.origem ?? 'manual', ts);
    }
    c.prepare('UPDATE bases SET atualizado_em = ? WHERE id = ?').run(ts, baseId);
  });
  return { gravadas: ops.length, anteriores };
}

// ---------------------------------------------------------------------------
// Vínculos
// ---------------------------------------------------------------------------

export type PedidoVinculo = { pendencia_id: number; pdf_id: number | null; pagina?: number | null; origem?: string };

/**
 * Vincula pendências a PDFs. Mesmas regras do Bater PDF: campo em P bloqueia
 * (P = "não decidi"), e um lote com qualquer linha travada não vincula nenhuma.
 */
export function vincular(baseId: string, pedidos: PedidoVinculo[], usuario?: string | null) {
  const c = db();
  const linhas = new Map(listarPendencias(baseId, { pendenciaIds: pedidos.map((p) => p.pendencia_id) })
    .map((l) => [l.pendencia_id, l]));
  const recusados: { pendencia_id: number; motivo: string }[] = [];
  for (const p of pedidos) {
    const l = linhas.get(p.pendencia_id);
    if (!l) { recusados.push({ pendencia_id: p.pendencia_id, motivo: 'pendência não é desta base' }); continue; }
    if (l.situacao !== 'pendente') { recusados.push({ pendencia_id: p.pendencia_id, motivo: 'já está batida' }); continue; }
    const marcas = Object.fromEntries(Object.entries(l.marcacoes).map(([k, m]) => [k, m!.valor]));
    const emP = camposEmP(l.lado, marcas);
    if (emP.length) {
      recusados.push({
        pendencia_id: p.pendencia_id,
        motivo: `Doc ${l.titulo.numero_documento ?? l.titulo.id} ainda tem ${emP.length} campo(s) em P (${emP.slice(0, 3).map((c) => c.rotulo).join(', ')}${emP.length > 3 ? ', …' : ''})`,
      });
    }
  }
  if (recusados.length) return { vinculados: 0, recusados };

  transacao(() => {
    const ins = c.prepare(`INSERT INTO vinculos (pendencia_id, pdf_id, pagina, marcacoes, leitura, origem, usuario, criado_em, leitura_id, tipo_match)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual')`);
    // O bate manual descarta o pré-bate da pendência (a leitura dele volta a ficar livre).
    const apagarPreBate = c.prepare('DELETE FROM pre_matches WHERE pendencia_id = ?');
    const upd = c.prepare("UPDATE pendencias SET situacao = 'vinculado' WHERE id = ?");
    // PDF desta base ou de outra base do mesmo fundo (o termo costuma subir numa base só).
    const pdfDoFundo = c.prepare(`SELECT 1 FROM pdfs d JOIN bases b ON b.id = d.base_id WHERE d.id = ? AND (d.base_id = ?
      OR (b.cnpj_fundo IS NOT NULL AND b.cnpj_fundo = (SELECT cnpj_fundo FROM bases WHERE id = ?)))`);
    const ts = agora();
    for (const p of pedidos) {
      const l = linhas.get(p.pendencia_id)!;
      if (p.pdf_id !== null && !pdfDoFundo.get(p.pdf_id, baseId, baseId)) {
        throw new ErroDeUso('O PDF escolhido não é desta base nem de outra base do mesmo fundo.');
      }
      const marcacoes: Partial<Record<CampoId, Veredito>> = {};
      const leitura: Partial<Record<CampoId, string | null>> = {};
      for (const def of camposDoLado(l.lado)) {
        const m = l.marcacoes[def.campo]!;
        marcacoes[def.campo] = m.valor;
        leitura[def.campo] = valorDaLeitura(l.titulo, def.campo, m.valor, m.valor_digitado);
      }
      // A leitura do que o documento traz (V = valor da amostra, D = o digitado), como registroLeitura:
      // é ela que Resultados, Visualizar e a exportação mostram.
      const leituraId = inserirLeitura(c, {
        base_id: baseId, pdf_id: p.pdf_id, tipo_recebivel: tipoRecebivelDoLado(l.lado, l.titulo.tipo_recebivel),
        origem: 'bater_pdf', campos: leitura, lida_em: ts,
      });
      ins.run(p.pendencia_id, p.pdf_id, p.pagina ?? null, JSON.stringify(marcacoes), JSON.stringify(leitura),
        p.origem ?? 'manual', usuario ?? null, ts, leituraId);
      upd.run(p.pendencia_id);
      apagarPreBate.run(p.pendencia_id);
    }
    c.prepare('UPDATE bases SET atualizado_em = ? WHERE id = ?').run(ts, baseId);
  });
  return { vinculados: pedidos.length, recusados };
}

export function desvincular(baseId: string, pendenciaIds: number[]) {
  const c = db();
  let n = 0;
  transacao(() => {
    for (const id of pendenciaIds) {
      const p = c.prepare("SELECT 1 FROM pendencias WHERE id = ? AND base_id = ? AND situacao = 'vinculado'").get(id, baseId);
      if (!p) continue;
      const v = c.prepare('SELECT leitura_id FROM vinculos WHERE pendencia_id = ?').get(id) as { leitura_id: number | null } | undefined;
      c.prepare('DELETE FROM vinculos WHERE pendencia_id = ?').run(id);
      // A leitura feita pelo Bater PDF só existia para este vínculo; a da IA ou da planilha fica (volta a ser órfã).
      if (v?.leitura_id) c.prepare("DELETE FROM leituras WHERE id = ? AND origem = 'bater_pdf'").run(v.leitura_id);
      c.prepare("UPDATE pendencias SET situacao = 'pendente' WHERE id = ?").run(id);
      n++;
    }
  });
  return { desvinculados: n };
}

// ---------------------------------------------------------------------------
// PDFs, páginas e busca
// ---------------------------------------------------------------------------

export function registrarPdf(baseId: string, pdf: { nome_arquivo: string; caminho_relativo: string | null; sha256: string; tamanho: number; tipo_declarado?: Lado | null }) {
  const c = db();
  const existente = c.prepare('SELECT id, status FROM pdfs WHERE base_id = ? AND sha256 = ?').get(baseId, pdf.sha256) as { id: number; status: string } | undefined;
  if (existente) {
    // Reenvio de PDF que falhou: tenta indexar de novo.
    if (existente.status === 'falhou') c.prepare("UPDATE pdfs SET status = 'pendente', erro = NULL WHERE id = ?").run(existente.id);
    return { id: existente.id, novo: false };
  }
  const r = c.prepare(`INSERT INTO pdfs (base_id, nome_arquivo, caminho_relativo, sha256, tamanho, tipo_declarado, enviado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(baseId, pdf.nome_arquivo, pdf.caminho_relativo, pdf.sha256, pdf.tamanho, pdf.tipo_declarado ?? null, agora());
  return { id: Number(r.lastInsertRowid), novo: true };
}

export function listarPdfs(baseId: string): PdfInfo[] {
  return db().prepare(`SELECT d.id, d.nome_arquivo, d.caminho_relativo, d.sha256, d.tamanho, d.total_paginas, d.paginas_com_texto,
      d.status, d.erro, d.tipo_declarado, (SELECT COUNT(*) FROM vinculos v WHERE v.pdf_id = d.id) AS vinculos
    FROM pdfs d WHERE d.base_id = ? ORDER BY d.nome_arquivo COLLATE NOCASE`).all(baseId) as PdfInfo[];
}

export function obterPdf(pdfId: number) {
  return db().prepare('SELECT id, base_id, nome_arquivo, sha256, tamanho, status FROM pdfs WHERE id = ?').get(pdfId) as
    { id: number; base_id: string; nome_arquivo: string; sha256: string; tamanho: number; status: string } | undefined;
}

export function definirTipoPdf(baseId: string, pdfId: number, tipo: Lado | null) {
  db().prepare('UPDATE pdfs SET tipo_declarado = ? WHERE id = ? AND base_id = ?').run(tipo, pdfId, baseId);
}

export const MIN_CHARS_BUSCA = 3;

export type ResultadoBusca = {
  pdf_id: number;
  nome_arquivo: string;
  pagina: number;
  paginas_com_termo: number;
  trecho: string;
  /** Posição do termo dentro de `trecho` (para destacar). */
  destaque: [number, number];
  vinculos: number;
};

/**
 * Busca "tipo grep" no texto já indexado: um resultado por PDF (a primeira
 * página que bate), com o trecho do texto original em volta do termo — como
 * _buscar_paginas_com_termo do Bate Lastro.
 */
export function buscarNosPdfs(baseId: string, termo: string, limite = 300):
  { resultados: ResultadoBusca[]; motivo?: 'termo_curto'; total_pdfs: number } {
  const alvo = normalizarTexto(termo).trim().replace(/%/g, '');
  if (alvo.length < MIN_CHARS_BUSCA) return { resultados: [], motivo: 'termo_curto', total_pdfs: 0 };
  const c = db();
  const achados = c.prepare(`
    SELECT p.pdf_id, MIN(p.numero) AS pagina, COUNT(*) AS paginas_com_termo
    FROM paginas_fts f JOIN paginas p ON p.id = f.rowid JOIN pdfs d ON d.id = p.pdf_id
    WHERE f.texto_normalizado LIKE ? AND d.base_id = ?
    GROUP BY p.pdf_id
    LIMIT ?
  `).all(`%${alvo}%`, baseId, limite) as { pdf_id: number; pagina: number; paginas_com_termo: number }[];
  const pagina = c.prepare(`SELECT p.texto, p.texto_normalizado, d.nome_arquivo,
      (SELECT COUNT(*) FROM vinculos v WHERE v.pdf_id = d.id) AS vinculos
    FROM paginas p JOIN pdfs d ON d.id = p.pdf_id WHERE p.pdf_id = ? AND p.numero = ?`);
  const resultados = achados.map((a) => {
    const pg = pagina.get(a.pdf_id, a.pagina) as { texto: string; texto_normalizado: string; nome_arquivo: string; vinculos: number };
    const pos = Math.max(0, pg.texto_normalizado.indexOf(alvo));
    const ini = Math.max(0, pos - 60);
    const fim = Math.min(pg.texto.length, pos + alvo.length + 60);
    const trecho = pg.texto.slice(ini, fim).replace(/\s+/g, ' ');
    // O trecho tem espaços colapsados: reposiciona o destaque pelo texto normalizado do próprio trecho.
    const posNoTrecho = normalizarTexto(trecho).indexOf(alvo);
    return {
      pdf_id: a.pdf_id,
      nome_arquivo: pg.nome_arquivo,
      pagina: a.pagina,
      paginas_com_termo: a.paginas_com_termo,
      trecho,
      destaque: (posNoTrecho >= 0 ? [posNoTrecho, posNoTrecho + alvo.length] : [0, 0]) as [number, number],
      vinculos: pg.vinculos,
    };
  }).sort((a, b) => a.nome_arquivo.localeCompare(b.nome_arquivo, 'pt-BR', { numeric: true }));
  const total = (c.prepare("SELECT COUNT(*) n FROM pdfs WHERE base_id = ? AND status = 'indexado'").get(baseId) as { n: number }).n;
  return { resultados, total_pdfs: total };
}

/** Páginas onde o termo aparece num PDF (para o visualizador pular entre elas). */
export function paginasComTermo(pdfId: number, termo: string): number[] {
  const alvo = normalizarTexto(termo).trim().replace(/%/g, '');
  if (alvo.length < MIN_CHARS_BUSCA) return [];
  return (db().prepare(`SELECT p.numero FROM paginas_fts f JOIN paginas p ON p.id = f.rowid
      WHERE f.texto_normalizado LIKE ? AND p.pdf_id = ? ORDER BY p.numero`).all(`%${alvo}%`, pdfId) as { numero: number }[])
    .map((r) => r.numero);
}

// Documento que acompanha o título mas não é ele (bilhete do seguro prestamista):
// fica fora da pré-classificação (_RE_DOCUMENTO_ACESSORIO / _paginas_da_base).
const RE_DOCUMENTO_ACESSORIO = /dados\s+do\s+segurado|bilhete\s+(?:de\s+seguro|numero)/;

/** Páginas da base para o motor (o PDF é identificado pelo id, em texto). */
export function paginasParaMotor(baseId: string) {
  const c = db();
  const linhas = c.prepare(`SELECT p.pdf_id, p.numero, p.texto_normalizado FROM paginas p JOIN pdfs d ON d.id = p.pdf_id
    WHERE d.base_id = ? ORDER BY p.pdf_id, p.numero`).all(baseId) as { pdf_id: number; numero: number; texto_normalizado: string }[];
  const acessorios = new Set<number>();
  for (const l of linhas) {
    if (l.numero === 1 && RE_DOCUMENTO_ACESSORIO.test(l.texto_normalizado.slice(0, 400))) acessorios.add(l.pdf_id);
  }
  return linhas
    .filter((l) => !acessorios.has(l.pdf_id))
    .map((l) => ({ pdf: String(l.pdf_id), pagina: l.numero, texto_normalizado: l.texto_normalizado }));
}

export function nomesDosPdfs(baseId: string): Record<string, string> {
  const r: Record<string, string> = {};
  for (const p of db().prepare('SELECT id, nome_arquivo FROM pdfs WHERE base_id = ?').all(baseId) as { id: number; nome_arquivo: string }[]) {
    r[String(p.id)] = p.nome_arquivo;
  }
  return r;
}

// ---------------------------------------------------------------------------
// Entrada do motor de pré-classificação (o que carregar_e_pre_classificar lê do banco)
// ---------------------------------------------------------------------------

const BASE_DO_TITULO = (t: Titulo) => ({
  base_tipo_recebivel: t.tipo_recebivel,
  base_numero_documento: t.numero_documento,
  base_sacado_nome: t.sacado_nome,
  base_sacado_documento: t.sacado_documento,
  base_cedente_nome: t.cedente_nome,
  base_cedente_documento: t.cedente_documento,
  base_valor_total: t.valor_total,
  base_valor_aquisicao: t.valor_aquisicao,
  base_data_emissao: t.data_emissao,
  base_data_vencimento: t.data_vencimento,
  base_nome_fundo: t.nome_fundo,
  base_cnpj_fundo: t.cnpj_fundo,
  base_data_aquisicao: t.data_aquisicao,
});

const tipoDocumento = (lado: Lado) => (lado === 'termo' ? 'termo_cessao' : 'lastro');

/** Outras bases locais do mesmo fundo (mesmo CNPJ): os termos costumam subir numa base só. */
function outrasBasesDoFundo(baseId: string): { id: string; rotulo: string }[] {
  const base = db().prepare('SELECT cnpj_fundo FROM bases WHERE id = ?').get(baseId) as { cnpj_fundo: string | null } | undefined;
  if (!base?.cnpj_fundo) return [];
  return (db().prepare('SELECT id, nome, data_referencia FROM bases WHERE cnpj_fundo = ? AND id <> ?').all(base.cnpj_fundo, baseId) as
    { id: string; nome: string; data_referencia: string | null }[]).map((b) => ({ id: b.id, rotulo: `${b.nome}${b.data_referencia ? ` — ref. ${b.data_referencia}` : ''}` }));
}

export function entradaDoMotor(baseId: string) {
  const c = db();
  const base = obterBase(baseId);
  const linhas = listarPendencias(baseId);
  const pendencias = linhas.filter((l) => l.situacao === 'pendente').map((l) => ({
    unmatch_id: l.pendencia_id,
    registro_base_id: l.titulo_id,
    tipo_documento: tipoDocumento(l.lado),
    ...BASE_DO_TITULO(l.titulo),
  }));

  const tiposPdf: Record<string, boolean> = {};
  const pdfsComLastro: string[] = [];
  for (const p of c.prepare('SELECT id, tipo_declarado FROM pdfs WHERE base_id = ? AND tipo_declarado IS NOT NULL').all(baseId) as { id: number; tipo_declarado: Lado }[]) {
    tiposPdf[String(p.id)] = p.tipo_declarado === 'termo';
    if (p.tipo_declarado === 'lastro') pdfsComLastro.push(String(p.id));
  }

  // Aprendizado: vínculos feitos aqui (nesta base e nas outras do mesmo fundo), com o veredito por campo.
  // Como _SQL_VINCULOS_CONFERIDOS (todos desta base) + _DO_FUNDO (até 3.000 das outras).
  const outras = outrasBasesDoFundo(baseId);
  const vinculos: Record<string, unknown>[] = [];
  let doFundo = 0;
  for (const id of [baseId, ...outras.map((o) => o.id)]) {
    for (const l of listarPendencias(id)) {
      if (id !== baseId && doFundo >= 3000) break;
      if (id !== baseId && l.vinculo?.pdf_id) doFundo++;
      if (!l.vinculo?.pdf_id) continue;
      const leitura = l.vinculo.leitura;
      vinculos.push({
        registro_base_id: l.titulo_id,
        tipo_documento: tipoDocumento(l.lado),
        marcacoes_campos: l.vinculo.marcacoes,
        processed_pdf: String(l.vinculo.pdf_id),
        ...BASE_DO_TITULO(l.titulo),
        leitura_numero_documento: leitura.numero_documento ?? null,
        leitura_sacado_nome: leitura.sacado_nome ?? null,
        leitura_sacado_documento: leitura.sacado_documento ?? null,
        leitura_cedente_nome: leitura.cedente_nome ?? null,
        leitura_cedente_documento: leitura.cedente_documento ?? null,
        leitura_valor_total: leitura.valor_total ?? null,
        leitura_data_emissao: leitura.data_emissao ?? null,
        leitura_data_vencimento: leitura.data_vencimento ?? null,
        leitura_data_aquisicao: leitura.data_aquisicao ?? null,
        leitura_nome_cessionario: leitura.nome_cessionario ?? null,
        leitura_doc_cessionario: leitura.doc_cessionario ?? null,
      });
    }
  }

  // O mesmo arquivo (sha256) já nesta base não entra como "de outra base": a cópia
  // daqui vence, como o `if pdf in pdfs_da_base: continue` de carregar_e_pre_classificar.
  const shasDaBase = new Set((c.prepare('SELECT sha256 FROM pdfs WHERE base_id = ?').all(baseId) as { sha256: string }[]).map((r) => r.sha256));
  const outrasPaginas = outras.length
    ? (c.prepare(`SELECT d.base_id, d.sha256, p.pdf_id, p.numero, p.texto_normalizado FROM paginas p JOIN pdfs d ON d.id = p.pdf_id
        WHERE d.base_id IN (${outras.map(() => '?').join(',')})`).all(...outras.map((o) => o.id)) as
        { base_id: string; sha256: string; pdf_id: number; numero: number; texto_normalizado: string }[])
      .filter((p) => !shasDaBase.has(p.sha256))
      .map((p) => ({ base_id: p.base_id, pdf: String(p.pdf_id), pagina: p.numero, texto_normalizado: p.texto_normalizado }))
    : [];

  const todosTitulos = linhas.map((l) => BASE_DO_TITULO(l.titulo));
  const nomes = nomesDosPdfs(baseId);
  for (const o of outras) Object.assign(nomes, nomesDosPdfs(o.id));
  return {
    base,
    pendencias,
    paginas: paginasParaMotor(baseId),
    tiposPdf,
    pdfsComLastro,
    vinculos,
    outrasBases: outras.length ? { paginas: outrasPaginas, rotulos: Object.fromEntries(outras.map((o) => [o.id, o.rotulo])) } : undefined,
    amostra: todosTitulos,
    nomesPdfs: nomes,
  };
}

// ---------------------------------------------------------------------------
// Pré-classificação (resultado guardado para reabrir a conferência)
// ---------------------------------------------------------------------------

export function salvarPreClassificacao(baseId: string, resultado: unknown, duracaoMs: number) {
  db().prepare(`INSERT INTO pre_classificacoes (base_id, executado_em, duracao_ms, resultado) VALUES (?, ?, ?, ?)
    ON CONFLICT(base_id) DO UPDATE SET executado_em = excluded.executado_em, duracao_ms = excluded.duracao_ms, resultado = excluded.resultado`)
    .run(baseId, agora(), duracaoMs, JSON.stringify(resultado));
}

export function obterPreClassificacao(baseId: string): { executado_em: string; duracao_ms: number; resultado: unknown } | null {
  const r = db().prepare('SELECT executado_em, duracao_ms, resultado FROM pre_classificacoes WHERE base_id = ?').get(baseId) as
    { executado_em: string; duracao_ms: number; resultado: string } | undefined;
  return r ? { ...r, resultado: JSON.parse(r.resultado) } : null;
}

// ---------------------------------------------------------------------------
// Exportação
// ---------------------------------------------------------------------------

/**
 * Linhas do resultados_matching (como o "Exportar para Excel" de Resultados do Bate Lastro):
 * vínculos e pré-bates com STATUS V; com `incluirPendentes`, também os títulos sem documento (P).
 */
export function linhasParaExportar(baseId: string, opcoes: { incluirPendentes: boolean }): LinhaExportacao[] {
  return linhasDaExportacao(baseId, opcoes);
}

/** Backup completo (JSON) da base: títulos, marcações, vínculos e PDFs. */
export function backupDaBase(baseId: string) {
  return {
    formato: 'bate-pdf/1',
    gerado_em: agora(),
    base: obterBase(baseId),
    pdfs: listarPdfs(baseId),
    pendencias: listarPendencias(baseId),
  };
}
