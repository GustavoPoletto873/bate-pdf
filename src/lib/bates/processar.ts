import { db, transacao } from '@/lib/db';
import type { Lado } from '@/lib/campos';
import { cascata, type RegistroCascata } from '@/lib/bates/cascata';
import { ladoDaLeitura } from '@/lib/bates/comparacao';

/**
 * "Processar Base" da Gestão de Bates (MatchServiceV2.process_pre_matches): para cada lado
 * (Termo e Lastro), roda a cascata entre as pendências ainda abertas e sem pré-bate e as leituras
 * daquele lado que ainda não estão num vínculo nem num pré-bate, e grava os pares em pre_matches.
 *
 * Diferenças em relação ao Bate Lastro: as pendências já existem desde a importação da base (lá é
 * este processamento que as cria em `unmatch`); não há leituras copiadas de outras bases; a
 * rejeição de um pré-bate não é lembrada (como lá: o par pode voltar no próximo processamento).
 */

export type MotivoProcessar = 'sem_leituras' | 'leitura_nova' | 'sem_leitura_nova';

/**
 * has_new_leitura_since_last_process: pode processar se sobrou leitura sem vínculo e sem
 * pré-bate. Sem nenhuma leitura também pode (lá é a "primeira vez"): o clique explica o que falta.
 */
export function podeProcessar(baseId: string): { pode_processar: boolean; motivo: MotivoProcessar } {
  const c = db();
  const total = (c.prepare('SELECT COUNT(*) n FROM leituras WHERE base_id = ?').get(baseId) as { n: number }).n;
  if (!total) return { pode_processar: true, motivo: 'sem_leituras' };
  const livre = c.prepare(`SELECT 1 FROM leituras l WHERE l.base_id = ?
      AND NOT EXISTS (SELECT 1 FROM vinculos v WHERE v.leitura_id = l.id)
      AND NOT EXISTS (SELECT 1 FROM pre_matches pm WHERE pm.leitura_id = l.id) LIMIT 1`).get(baseId);
  return livre ? { pode_processar: true, motivo: 'leitura_nova' } : { pode_processar: false, motivo: 'sem_leitura_nova' };
}

type PorLado = { total: number; termo: number; lastro: number };
const porLado = (termo: number, lastro: number): PorLado => ({ total: termo + lastro, termo, lastro });

export type ResultadoProcessamento = {
  mensagem: string;
  /** Só quando não havia leitura para casar: o processamento terminou, mas não casou nada. */
  aviso: string | null;
  tempo_processamento: string;
  quantidade_registro_base: PorLado;
  quantidade_registro_leitura: PorLado;
  quantidade_pre_matches: PorLado;
  /** Pendências que continuaram sem par. */
  quantidade_pendencias: PorLado;
};

/** Motivos de documentos do Anexo que falharam na leitura (coleta_erros_leitura). */
function motivosDeFalha(baseId: string): string[] | null {
  try {
    const linhas = db().prepare(`SELECT d.motivo FROM anexo_documentos d JOIN anexo_lotes l ON l.id = d.lote_id
      WHERE l.base_id = ? AND d.status = 'erro'`).all(baseId) as { motivo: string | null }[];
    if (!linhas.length) return null;
    return [...new Set(linhas.map((l) => (l.motivo ?? '').trim()).filter(Boolean))].sort();
  } catch {
    return null;
  }
}

export function processarBase(baseId: string): ResultadoProcessamento {
  const inicio = Date.now();
  const c = db();
  const contagem: Record<Lado, { bases: number; leituras: number; pares: number; sobra: number }> = {
    termo: { bases: 0, leituras: 0, pares: 0, sobra: 0 },
    lastro: { bases: 0, leituras: 0, pares: 0, sobra: 0 },
  };

  transacao(() => {
    // Leituras livres (sem vínculo e sem pré-bate), separadas pelo TIPO_RECEBIVEL.
    const leituras = c.prepare(`SELECT l.id, l.tipo_recebivel, l.numero_documento, l.valor_nominal AS valor, l.data_vencimento,
        l.data_emissao, l.data_aquisicao, l.cedente_documento AS doc_cedente, l.sacado_documento AS doc_sacado
      FROM leituras l WHERE l.base_id = ?
        AND NOT EXISTS (SELECT 1 FROM vinculos v WHERE v.leitura_id = l.id)
        AND NOT EXISTS (SELECT 1 FROM pre_matches pm WHERE pm.leitura_id = l.id)
      ORDER BY l.id`).all(baseId) as (RegistroCascata & { tipo_recebivel: string | null })[];

    const bases = c.prepare(`SELECT t.id, p.id AS pendencia_id, t.numero_documento, t.valor_total AS valor, t.data_vencimento,
        t.data_emissao, t.data_aquisicao, t.cedente_documento AS doc_cedente, t.sacado_documento AS doc_sacado
      FROM pendencias p JOIN titulos t ON t.id = p.titulo_id
      WHERE p.base_id = ? AND p.lado = ? AND p.situacao = 'pendente'
        AND NOT EXISTS (SELECT 1 FROM pre_matches pm WHERE pm.pendencia_id = p.id)
      ORDER BY t.id`);
    const inserir = c.prepare(`INSERT INTO pre_matches (base_id, pendencia_id, leitura_id, similaridade, criterio, criado_em)
      VALUES (?, ?, ?, ?, ?, ?)`);
    const ts = new Date().toISOString();

    for (const lado of ['termo', 'lastro'] as Lado[]) {
      const doLado = leituras.filter((l) => ladoDaLeitura(l.tipo_recebivel) === lado);
      const registros = bases.all(baseId, lado) as (RegistroCascata & { pendencia_id: number })[];
      const pendenciaDoTitulo = new Map(registros.map((r) => [r.id, r.pendencia_id]));
      const r = cascata(registros, doLado);
      for (const par of r.pares) inserir.run(baseId, pendenciaDoTitulo.get(par.base_id)!, par.leitura_id, par.similaridade, par.criterio, ts);
      contagem[lado] = { bases: registros.length, leituras: doLado.length, pares: r.pares.length, sobra: r.basesSemPar.length };
    }
    if (contagem.termo.pares + contagem.lastro.pares) c.prepare('UPDATE bases SET atualizado_em = ? WHERE id = ?').run(ts, baseId);
  });

  let aviso: string | null = null;
  if (!contagem.termo.leituras && !contagem.lastro.leituras) {
    const total = (c.prepare('SELECT COUNT(*) n FROM leituras WHERE base_id = ?').get(baseId) as { n: number }).n;
    const falhas = motivosDeFalha(baseId);
    if (total) {
      aviso = 'Todos os documentos lidos desta base já estão pareados. Envie novos documentos no Anexo ou resolva as pendências pelo Bater PDF.';
    } else if (falhas) {
      aviso = 'Os documentos desta base foram enviados, porém não foi possível concluir a leitura de nenhum deles.'
        + (falhas.length ? ` Motivo(s) identificado(s): ${falhas.join('; ')}.` : '')
        + ' As pendências estão listadas mesmo assim: dá para reenviar os arquivos ou bater os PDFs à mão pelo Bater PDF.';
    } else {
      aviso = 'Não há documentos de leitura carregados para esta base. As pendências estão listadas mesmo assim: '
        + 'envie os documentos no Anexo ou bata os PDFs à mão pelo Bater PDF.';
    }
  }

  return {
    mensagem: 'Processamento concluído com sucesso.',
    aviso,
    tempo_processamento: `${((Date.now() - inicio) / 1000).toFixed(2)}s`,
    quantidade_registro_base: porLado(contagem.termo.bases, contagem.lastro.bases),
    quantidade_registro_leitura: porLado(contagem.termo.leituras, contagem.lastro.leituras),
    quantidade_pre_matches: porLado(contagem.termo.pares, contagem.lastro.pares),
    quantidade_pendencias: porLado(contagem.termo.sobra, contagem.lastro.sobra),
  };
}
