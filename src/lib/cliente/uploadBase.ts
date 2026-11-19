'use client';

import { chamar } from '@/lib/cliente';
import type { AnaliseArquivo } from '@/lib/upload-base/colunas';
import type { ModoReferencia } from '@/lib/upload-base/datas';
import type { BaseRegistrada, PreviaResultados, UploadsRecentes } from '@/lib/upload-base/registrar';

/** Gestão › Upload Base (navegador). */

function formulario(arquivo: File, campos: Record<string, string | number | null | undefined> = {}) {
  const form = new FormData();
  form.append('arquivo', arquivo);
  for (const [k, v] of Object.entries(campos)) if (v !== null && v !== undefined && v !== '') form.append(k, String(v));
  return { method: 'POST', body: form } satisfies RequestInit;
}

/** Amostra sorteada em Gestão › Amostra (GET /api/amostragem/<id>). */
export type AmostraParaBase = { id: number; fundo_id: number; data_de?: string; data_ate: string; seed?: string };

export const apiUploadBase = {
  analisar: (arquivo: File) => chamar<AnaliseArquivo>('/api/upload-base/analisar', formulario(arquivo)),
  recentes: (fundoId: number, data: string, modo: ModoReferencia) =>
    chamar<UploadsRecentes>(`/api/upload-base/recentes?${new URLSearchParams({ fundo_id: String(fundoId), data_referencia: data, modo_referencia: modo })}`),
  processar: (arquivo: File, dados: { fundo_id: number; data_referencia: string; modo: ModoReferencia; mapeamento: Record<string, string> }) =>
    chamar<BaseRegistrada>('/api/upload-base', formulario(arquivo, {
      fundo_id: dados.fundo_id, data_referencia: dados.data_referencia, modo_referencia: dados.modo, mapeamento: JSON.stringify(dados.mapeamento),
    })),
  previaResultados: (arquivo: File) => chamar<PreviaResultados>('/api/upload-base/resultados', formulario(arquivo, { previa: '1' })),
  criarDeResultados: (arquivo: File, dados: { fundo_id: number | null; data_referencia: string; modo: ModoReferencia }) =>
    chamar<BaseRegistrada>('/api/upload-base/resultados', formulario(arquivo, {
      fundo_id: dados.fundo_id, data_referencia: dados.data_referencia, modo_referencia: dados.modo,
    })),
  amostra: (id: string) => chamar<AmostraParaBase>(`/api/amostragem/${encodeURIComponent(id)}`),
  /** A planilha da amostra como arquivo, para entrar no Upload Base como se tivesse sido escolhida. */
  arquivoDaAmostra: async (id: string): Promise<File> => {
    const r = await fetch(`/api/amostragem/${encodeURIComponent(id)}/download/amostra`);
    if (!r.ok) throw new Error(String(r.status));
    const disposicao = r.headers.get('content-disposition') ?? '';
    const nome = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposicao)?.[1];
    return new File([await r.blob()], nome ? decodeURIComponent(nome) : `amostra_${id}.xlsx`, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  },
};
