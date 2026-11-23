import { db } from '@/lib/db';
import { CAMPO_POR_ID, type CampoId, type Lado, type Veredito } from '@/lib/campos';
import { vereditosDoLado, type LeituraCampos } from '@/lib/bates/comparacao';
import { camposDaLeitura, COLUNAS_LEITURA, type LeituraLinha } from '@/lib/bates/leituras';
import { COLUNAS_TITULO, tituloDaLinha, type TituloDaBase } from '@/lib/bates/preMatches';
import type { LinhaExportacao } from '@/lib/planilha/exportar';
import { normalizarTexto } from '@/lib/texto';

/**
 * Resultados (routes/get/results.py): um título por lado conferido, com status V (vínculo,
 * pré-bate ou já batido no Bate Lastro) ou P (nenhum). O "D" de linha não existe mais no Bate
 * Lastro: a divergência fica por campo (vereditos salvos valem mais que a comparação).
 */

export type OrigemResultado = 'vinculo' | 'pre_bate' | 'ja_batido' | null;

export type LinhaResultado = {
  pendencia_id: number;
  titulo_id: number;
  lado: Lado;
  status: 'V' | 'P';
  origem: OrigemResultado;
  tipo_match: string | null;
  similaridade: number | null;
  /** origem do vínculo ('manual', 'conferencia', 'pre_bate', 'planilha'). */
  origem_vinculo: string | null;
  titulo: TituloDaBase;
  leitura: LeituraCampos | null;
  vereditos: Partial<Record<CampoId, Veredito>> | null;
  /** Campos em D. */
  divergencias: number;
  pdf: { id: number; nome: string; pagina: number | null } | null;
  criado_em: string | null;
};

type LinhaBruta = { pendencia_id: number; lado: Lado; situacao: string } & Record<string, unknown>;

export async function linhasDeResultado(baseId: string): Promise<LinhaResultado[]> {
  const c = await db();
  const pendencias = await c.prepare(`SELECT p.id AS pendencia_id, p.lado, p.situacao, ${COLUNAS_TITULO}
    FROM pendencias p JOIN titulos t ON t.id = p.titulo_id WHERE p.base_id = ? ORDER BY t.id, p.lado DESC`).all(baseId) as LinhaBruta[];

  type VinculoBruto = { pendencia_id: number; pdf_id: number | null; pdf_nome: string | null; pagina: number | null; marcacoes: string;
    leitura: string; origem: string; tipo_match: string; similaridade: number | null; criado_em: string };
  const vinculos = new Map<number, VinculoBruto>();
  for (const v of await c.prepare(`SELECT v.pendencia_id, v.pdf_id, d.nome_arquivo AS pdf_nome, v.pagina, v.marcacoes, v.leitura, v.origem,
      v.tipo_match, v.similaridade, v.criado_em
    FROM vinculos v JOIN pendencias p ON p.id = v.pendencia_id LEFT JOIN pdfs d ON d.id = v.pdf_id WHERE p.base_id = ?`).all(baseId) as VinculoBruto[]) {
    vinculos.set(v.pendencia_id, v);
  }

  const pre = new Map<number, LeituraLinha & { similaridade: number; pdf_nome: string | null; criado_em_pre: string }>();
  for (const r of await c.prepare(`SELECT pm.pendencia_id, pm.similaridade, pm.criado_em AS criado_em_pre, d.nome_arquivo AS pdf_nome, ${COLUNAS_LEITURA}
    FROM pre_matches pm JOIN leituras l ON l.id = pm.leitura_id LEFT JOIN pdfs d ON d.id = l.pdf_id WHERE pm.base_id = ?`).all(baseId) as
    (LeituraLinha & { pendencia_id: number; similaridade: number; pdf_nome: string | null; criado_em_pre: string })[]) {
    pre.set(r.pendencia_id, r);
  }

  return pendencias.map((p): LinhaResultado => {
    const titulo = tituloDaLinha(p);
    const base = { pendencia_id: p.pendencia_id, titulo_id: titulo.id, lado: p.lado, titulo };
    const v = vinculos.get(p.pendencia_id);
    if (p.situacao === 'vinculado' && v) {
      const leitura = JSON.parse(v.leitura) as LeituraCampos;
      const vereditos = vereditosDoLado(p.lado, titulo, leitura, JSON.parse(v.marcacoes));
      return {
        ...base, status: 'V', origem: 'vinculo', tipo_match: v.tipo_match, similaridade: v.similaridade, origem_vinculo: v.origem,
        leitura, vereditos, divergencias: Object.values(vereditos).filter((x) => x === 'D').length,
        pdf: v.pdf_id && v.pdf_nome ? { id: v.pdf_id, nome: v.pdf_nome, pagina: v.pagina } : null, criado_em: v.criado_em,
      };
    }
    if (p.situacao === 'ja_batido') {
      return { ...base, status: 'V', origem: 'ja_batido', tipo_match: null, similaridade: null, origem_vinculo: null, leitura: null, vereditos: null, divergencias: 0, pdf: null, criado_em: null };
    }
    const pm = pre.get(p.pendencia_id);
    if (pm) {
      const leitura = camposDaLeitura(pm, p.lado);
      const vereditos = vereditosDoLado(p.lado, titulo, leitura);
      return {
        ...base, status: 'V', origem: 'pre_bate', tipo_match: 'automatico', similaridade: pm.similaridade, origem_vinculo: null,
        leitura, vereditos, divergencias: Object.values(vereditos).filter((x) => x === 'D').length,
        pdf: pm.pdf_id && pm.pdf_nome ? { id: pm.pdf_id, nome: pm.pdf_nome, pagina: null } : null, criado_em: pm.criado_em_pre,
      };
    }
    return { ...base, status: 'P', origem: null, tipo_match: null, similaridade: null, origem_vinculo: null, leitura: null, vereditos: null, divergencias: 0, pdf: null, criado_em: null };
  });
}

// ---------------------------------------------------------------------------
// Estatísticas (/results/statistics)
// ---------------------------------------------------------------------------

type ContagemLado = { total: number; total_v: number; total_p: number; taxa: number };
export type EstatisticasResultado = {
  total_registros: number;
  geral: ContagemLado;
  termo: ContagemLado;
  lastro: ContagemLado;
  /** De onde vêm os V: vínculos (manuais/automáticos), pré-bates e já batidos no Bate Lastro. */
  origem_v: { manual: number; automatico: number; pre_bate: number; ja_batido: number };
  divergentes: number;
};

const contar = (linhas: LinhaResultado[]): ContagemLado => {
  const v = linhas.filter((l) => l.status === 'V').length;
  return { total: linhas.length, total_v: v, total_p: linhas.length - v, taxa: linhas.length ? Math.round((v / linhas.length) * 10000) / 100 : 0 };
};

export function estatisticas(linhas: LinhaResultado[]): EstatisticasResultado {
  return {
    total_registros: new Set(linhas.map((l) => l.titulo_id)).size,
    geral: contar(linhas),
    termo: contar(linhas.filter((l) => l.lado === 'termo')),
    lastro: contar(linhas.filter((l) => l.lado === 'lastro')),
    origem_v: {
      manual: linhas.filter((l) => l.origem === 'vinculo' && l.tipo_match !== 'automatico').length,
      automatico: linhas.filter((l) => l.origem === 'vinculo' && l.tipo_match === 'automatico').length,
      pre_bate: linhas.filter((l) => l.origem === 'pre_bate').length,
      ja_batido: linhas.filter((l) => l.origem === 'ja_batido').length,
    },
    divergentes: linhas.filter((l) => l.divergencias > 0).length,
  };
}

export type FiltroResultados = {
  aba?: 'todos' | 'termo' | 'lastro';
  status?: 'todos' | 'V' | 'P';
  texto?: string;
  pagina?: number;
  tamanho?: number;
};

export function filtrarResultados(linhas: LinhaResultado[], f: FiltroResultados) {
  const alvo = normalizarTexto((f.texto ?? '').trim());
  const digitos = (f.texto ?? '').replace(/\D/g, '');
  const filtradas = linhas.filter((l) => {
    if (f.aba && f.aba !== 'todos' && l.lado !== f.aba) return false;
    if (f.status && f.status !== 'todos' && l.status !== f.status) return false;
    if (!alvo) return true;
    const t = l.titulo;
    return normalizarTexto(`${t.numero_documento ?? ''} ${t.sacado_nome ?? ''} ${t.cedente_nome ?? ''} ${l.pdf?.nome ?? ''}`).includes(alvo)
      || (digitos.length >= 3 && `${t.sacado_documento ?? ''} ${t.cedente_documento ?? ''}`.replace(/\D/g, '').includes(digitos));
  });
  const tamanho = Math.min(Math.max(f.tamanho ?? 50, 1), 500);
  const paginas = Math.max(1, Math.ceil(filtradas.length / tamanho));
  const pagina = Math.min(Math.max(f.pagina ?? 1, 1), paginas);
  return { linhas: filtradas.slice((pagina - 1) * tamanho, pagina * tamanho), total: filtradas.length, pagina, tamanho };
}

// ---------------------------------------------------------------------------
// Exportação (resultados_matching e pendências)
// ---------------------------------------------------------------------------

/** Papéis da BlackList por título ('Cedente', 'Sacado', 'Cedente / Sacado'). */
async function blacklistDaBase(baseId: string): Promise<Map<number, string>> {
  const r = new Map<number, string>();
  try {
    const linhas = await (await db()).prepare('SELECT titulo_id, papel FROM blacklist_ocorrencias WHERE base_id = ?').all(baseId) as { titulo_id: number; papel: string }[];
    const papeis = new Map<number, Set<string>>();
    for (const l of linhas) {
      const s = papeis.get(l.titulo_id) ?? new Set();
      s.add(l.papel.toLowerCase());
      papeis.set(l.titulo_id, s);
    }
    for (const [id, s] of papeis) {
      r.set(id, [s.has('cedente') && 'Cedente', s.has('sacado') && 'Sacado'].filter(Boolean).join(' / '));
    }
  } catch {
    // Sem a BlackList, o resto da planilha sai igual (como lá).
  }
  return r;
}

const ORIGEM_EXPORTADA: Record<string, string> = {
  vinculo: 'bate-pdf',
  pre_bate: 'bate-pdf:pre_bate_a_confirmar',
  ja_batido: 'bate-lastro:ja_batido',
};

/**
 * Linhas do resultados_matching: uma por título × lado conferido nesta base. Pré-bates saem com
 * STATUS V (como no Bate Lastro); os que vieram batidos do Bate Lastro saem com STATUS V mas sem
 * leitura e sem DIV_* (o Inserir Resultado de lá não mexe nos vereditos que já tem).
 */
export async function linhasDaExportacao(baseId: string, opcoes: { incluirPendentes: boolean } = { incluirPendentes: true }): Promise<LinhaExportacao[]> {
  const blacklist = await blacklistDaBase(baseId);
  return (await linhasDeResultado(baseId))
    .filter((l) => opcoes.incluirPendentes || l.status === 'V')
    .map((l) => {
      const salvas: Partial<Record<CampoId, Veredito>> = l.origem === 'vinculo' && l.vereditos ? l.vereditos : {};
      return {
        lado: l.lado,
        titulo: l.titulo,
        status: l.status,
        marcacoes: salvas,
        leitura: l.leitura ?? {},
        pdf: l.pdf ? { nome: l.pdf.nome, pagina: l.pdf.pagina } : null,
        origem: l.origem === 'vinculo' ? `bate-pdf:${l.origem_vinculo ?? 'manual'}` : l.origem ? ORIGEM_EXPORTADA[l.origem] : null,
        jaBatido: l.origem === 'ja_batido',
        blacklist: blacklist.get(l.titulo_id) || 'Não',
      };
    });
}

/** Título × lado ainda sem documento (pendências do export de pendências). */
export async function pendenciasParaExportar(baseId: string) {
  const linhas = await linhasDeResultado(baseId);
  const porTitulo = new Map<number, { titulo: TituloDaBase; termo: 'V' | 'P' | null; lastro: 'V' | 'P' | null }>();
  for (const l of linhas) {
    const e = porTitulo.get(l.titulo_id) ?? { titulo: l.titulo, termo: null, lastro: null };
    e[l.lado] = l.status;
    porTitulo.set(l.titulo_id, e);
  }
  return {
    // Layout 1: uma linha por título × lado faltante, Lastro primeiro.
    faltantes: [...linhas.filter((l) => l.status === 'P' && l.lado === 'lastro'), ...linhas.filter((l) => l.status === 'P' && l.lado === 'termo')]
      .map((l) => ({ lado: l.lado, titulo: l.titulo })),
    // Layout 2: uma linha por título com algum P.
    consolidadas: [...porTitulo.values()].filter((e) => e.termo === 'P' || e.lastro === 'P'),
  };
}

export const ROTULO_CAMPO = (campo: CampoId) => CAMPO_POR_ID[campo].rotulo;
