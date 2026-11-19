'use client';

import type { BaseResumo, PdfInfo, PendenciaLinha, ResultadoBusca, OperacaoMarcacao, PedidoVinculo } from '@/lib/repo';

/** Chamadas à API do próprio app (navegador). Erro de uso volta com a mensagem da tela. */

export class ErroApi extends Error {
  constructor(mensagem: string, public status: number, public dados?: unknown) {
    super(mensagem);
  }
}

/** Chamada comum (use nos clientes de cada módulo, em src/lib/cliente/<modulo>.ts). */
export async function chamar<T>(url: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(url, init);
  } catch {
    throw new ErroApi('Sem conexão com o servidor do Lastro. Ele está rodando?', 0);
  }
  const tipo = resposta.headers.get('content-type') ?? '';
  const dados = tipo.includes('application/json') ? await resposta.json() : null;
  if (!resposta.ok) {
    throw new ErroApi((dados as { erro?: string })?.erro ?? `Erro ${resposta.status}`, resposta.status, dados);
  }
  return dados as T;
}

export const json = (corpo: unknown, metodo = 'POST'): RequestInit => ({
  method: metodo,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(corpo),
});

export const api = {
  bases: () => chamar<{ bases: BaseResumo[] }>('/api/bases'),
  base: (id: string) => chamar<{ base: BaseResumo; indexando: boolean }>(`/api/bases/${id}`),
  criarBase: (form: FormData) => chamar<{ id?: string; previa?: PreviaImportacao }>('/api/bases', { method: 'POST', body: form }),
  atualizarBase: (id: string, dados: Record<string, string | null>) => chamar<{ base: BaseResumo }>(`/api/bases/${id}`, json(dados, 'PATCH')),
  excluirBase: (id: string) => chamar<{ ok: true }>(`/api/bases/${id}`, { method: 'DELETE' }),
  pendencias: (id: string) => chamar<{ pendencias: PendenciaLinha[] }>(`/api/bases/${id}/pendencias`),
  salvarMarcacoes: (id: string, operacoes: OperacaoMarcacao[]) =>
    chamar<{ gravadas: number; anteriores: OperacaoMarcacao[] }>(`/api/bases/${id}/marcacoes`, json({ operacoes })),
  vincular: (id: string, itens: PedidoVinculo[]) =>
    chamar<{ vinculados: number; recusados: { pendencia_id: number; motivo: string }[] }>(`/api/bases/${id}/vinculos`, json({ itens })),
  desvincular: (id: string, pendencia_ids: number[]) =>
    chamar<{ desvinculados: number }>(`/api/bases/${id}/vinculos`, json({ pendencia_ids }, 'DELETE')),
  pdfs: (id: string) => chamar<{ pdfs: PdfInfo[]; indexando: boolean }>(`/api/bases/${id}/pdfs`),
  enviarPdfs: (id: string, form: FormData) =>
    chamar<{ novos: number; repetidos: number; recusados: { nome: string; motivo: string }[] }>(`/api/bases/${id}/pdfs`, { method: 'POST', body: form }),
  ajustarPdf: (id: string, corpo: { pdf_id?: number; tipo?: 'termo' | 'lastro' | null; reindexar?: boolean }) =>
    chamar<{ ok: true; indexando: boolean }>(`/api/bases/${id}/pdfs`, json(corpo, 'PATCH')),
  buscar: (id: string, q: string) =>
    chamar<{ resultados: ResultadoBusca[]; motivo?: 'termo_curto'; total_pdfs: number }>(`/api/bases/${id}/buscar?q=${encodeURIComponent(q)}`),
  paginasComTermo: (pdfId: number, q: string) =>
    chamar<{ paginas: number[] }>(`/api/pdfs/${pdfId}/paginas?q=${encodeURIComponent(q)}`),
  preClassificar: (id: string) => chamar<{ executado_em: string; duracao_ms: number; resultado: ResultadoPreClassificacaoTela }>(`/api/bases/${id}/pre-classificar`, { method: 'POST' }),
  ultimaPreClassificacao: (id: string) =>
    chamar<{ executado_em: string; duracao_ms: number; resultado: ResultadoPreClassificacaoTela } | null>(`/api/bases/${id}/pre-classificar`),
};

export type PreviaImportacao = {
  formato: 'resultados_matching' | 'amostra';
  titulos: number;
  pendentes: { termo: number; lastro: number };
  ja_batidos: number;
  nome_fundo: string | null;
  cnpj_fundo: string | null;
  mapeamento: Record<string, string>;
  avisos: string[];
  exemplo: Record<string, unknown>[];
};

/** Formato da pré-classificação que a tela consome (o mesmo JSON do Bate Lastro, com nomes de PDF). */
export type ResultadoPreClassificacaoTela = {
  total: number;
  resumo: Record<string, number>;
  pdfs_analisados: number;
  paginas_analisadas: number;
  regras_fundo: Record<string, unknown>;
  resultados: SugestaoTitulo[];
  nomes_pdfs: Record<string, string>;
};

export type StatusCampoSugerido = {
  valor: 'V' | 'D' | 'P';
  encontrado?: string | null;
  regra?: string | null;
  alerta?: unknown;
  aviso?: unknown;
  sem_confirmacao?: unknown;
  /** [página, início, fim] no texto da página do candidato de `origem`. */
  evidencias?: unknown[];
  fonte?: Record<string, unknown> | null;
  /** De qual candidato vêm as evidências: 'lastro' | 'termo' | 'referencia'. */
  origem?: string | null;
  [k: string]: unknown;
};

export type CandidatoSugerido = {
  pdf: string;
  pagina?: number;
  confianca?: string;
  score?: number;
  [k: string]: unknown;
};

export type SugestaoTitulo = {
  registro_base_id: number;
  confianca: string;
  campos: Record<string, StatusCampoSugerido>;
  candidatos: Record<string, CandidatoSugerido>;
  alternativas?: unknown;
  registros: { unmatch_id: number; registro_base_id: number; tipo_documento: string }[];
  [k: string]: unknown;
};
