import { ROTULO_TIPO } from '@/lib/ia/modelos';

/** Rótulos e cores das situações dos documentos do Anexo (também usados em Lotes). */

export type CorEtiqueta = 'slate' | 'emerald' | 'amber' | 'rose' | 'indigo' | 'violet' | 'sky' | 'orange';

export const SITUACAO: Record<string, { rotulo: string; cor: CorEtiqueta; final: boolean }> = {
  recebido: { rotulo: 'Recebido', cor: 'slate', final: false },
  enfileirado: { rotulo: 'Na fila', cor: 'slate', final: false },
  classificando: { rotulo: 'Classificando', cor: 'sky', final: false },
  extraindo: { rotulo: 'Lendo os dados', cor: 'indigo', final: false },
  lido: { rotulo: 'Lastro/termo lido', cor: 'emerald', final: true },
  somente_classificado: { rotulo: 'Só classificado', cor: 'amber', final: true },
  erro: { rotulo: 'Não lido (erro)', cor: 'rose', final: true },
};

export const situacao = (s: string) => SITUACAO[s] ?? { rotulo: s, cor: 'slate' as const, final: false };

export const rotuloTipo = (t: string | null | undefined) => (t ? ROTULO_TIPO[t] ?? t : '—');

export const plural = (n: number, um: string, varios: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? um : varios}`;
