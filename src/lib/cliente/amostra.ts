'use client';

import { chamar, json } from '@/lib/cliente';
import type { Conferencia, DetalheAmostragem, FundoAmostra, Inspecao, ResumoAmostragem } from '@/lib/amostra/servico';

export type { Conferencia, DetalheAmostragem, FundoAmostra, Inspecao, ResumoAmostragem };

/** Chamadas da tela Gestão › Amostra. */

export type PedidoGerar = {
  fundoId: number;
  dataDe: string;
  dataAte: string;
  limiteAdquiridos: number;
  limiteVencidos: number;
  regra: 'padrao' | 'planner';
  estoques: File[];
  liquidados?: File[];
  amostraAnteriorId?: number | null;
  amostraAnteriorArquivo?: File | null;
  motivo?: string | null;
};

export const amostraApi = {
  fundos: () => chamar<{ fundos: FundoAmostra[] }>('/api/amostragem/fundos'),
  listar: (fundoId?: number | null) => chamar<{ items: ResumoAmostragem[] }>(`/api/amostragem${fundoId ? `?fundo_id=${fundoId}` : ''}`),
  obter: (id: number) => chamar<DetalheAmostragem>(`/api/amostragem/${id}`),
  gerar: (p: PedidoGerar) => {
    const f = new FormData();
    f.set('fundo_id', String(p.fundoId));
    f.set('data_de', p.dataDe);
    f.set('data_ate', p.dataAte);
    f.set('limite_adquiridos', String(p.limiteAdquiridos));
    f.set('limite_vencidos', String(p.limiteVencidos));
    f.set('regra', p.regra);
    p.estoques.forEach((a) => f.append('estoques', a));
    (p.liquidados ?? []).forEach((a) => f.append('liquidados', a));
    if (p.amostraAnteriorId) f.set('amostra_anterior_id', String(p.amostraAnteriorId));
    if (p.amostraAnteriorArquivo) f.set('amostra_anterior', p.amostraAnteriorArquivo);
    if (p.motivo) f.set('motivo', p.motivo);
    return chamar<DetalheAmostragem>('/api/amostragem', { method: 'POST', body: f });
  },
  descartar: (id: number, motivo: string) => chamar<DetalheAmostragem>(`/api/amostragem/${id}/descartar`, json({ motivo })),
  verificar: (id: number) => chamar<{ identica: boolean; divergencias: string[] }>(`/api/amostragem/${id}/verificar`, { method: 'POST' }),
  buscarPorSeed: (seed: string) => chamar<DetalheAmostragem>(`/api/amostragem/seed/${encodeURIComponent(seed)}`),
  inspecionar: (arquivos: File[], comDataBase: boolean) => {
    const f = new FormData();
    arquivos.forEach((a) => f.append('arquivos', a));
    if (comDataBase) f.set('data_base', '1');
    return chamar<{ arquivos: Inspecao[] }>('/api/amostragem/inspecionar', { method: 'POST', body: f });
  },
  conferir: (p: { seed: string; estoques: File[]; liquidados: File[]; dataDe?: string; dataAte?: string; limiteAdquiridos?: number; limiteVencidos?: number; regra?: string }) => {
    const f = new FormData();
    f.set('seed', p.seed);
    p.estoques.forEach((a) => f.append('estoques', a));
    p.liquidados.forEach((a) => f.append('liquidados', a));
    if (p.dataDe) f.set('data_de', p.dataDe);
    if (p.dataAte) f.set('data_ate', p.dataAte);
    if (p.limiteAdquiridos !== undefined) f.set('limite_adquiridos', String(p.limiteAdquiridos));
    if (p.limiteVencidos !== undefined) f.set('limite_vencidos', String(p.limiteVencidos));
    if (p.regra) f.set('regra', p.regra);
    return chamar<Conferencia>('/api/amostragem/conferir', { method: 'POST', body: f });
  },
  urlDownload: (id: number, tipo: 'amostra' | 'pacote') => `/api/amostragem/${id}/download/${tipo}`,
  /** Baixa o arquivo (Blob + nome do Content-Disposition). */
  arquivo: async (id: number, tipo: 'amostra' | 'pacote'): Promise<{ nome: string; blob: Blob }> => {
    const r = await fetch(`/api/amostragem/${id}/download/${tipo}`);
    if (!r.ok) throw new Error('Não foi possível baixar o arquivo da amostra.');
    const cd = r.headers.get('content-disposition') ?? '';
    const m = /filename\*=UTF-8''([^;]+)/.exec(cd) ?? /filename="([^"]+)"/.exec(cd);
    return { nome: m ? decodeURIComponent(m[1]) : `amostra_${id}.${tipo === 'pacote' ? 'zip' : 'xlsx'}`, blob: await r.blob() };
  },
};

/** Dispara o download de um Blob no navegador. */
export function salvarArquivo(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
