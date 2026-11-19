'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { dataBr } from '@/lib/upload-base/datas';

/**
 * Filtros da Seleção de Auditoria (busca e período), guardados na sessão do navegador para
 * sobreviverem à ida aos Bates e volta (como o auditoriaSelection.filtros do Bate Lastro).
 * O sessionStorage é a fonte da verdade, lido por useSyncExternalStore (sem divergência na hidratação).
 */

export type FiltrosSelecao = { busca: string; tipo: 'trimestre' | 'data'; ano: string; trimestre: string; data: string };

export const FILTROS_VAZIOS: FiltrosSelecao = { busca: '', tipo: 'trimestre', ano: '', trimestre: '', data: '' };

const CHAVE = 'auditoriaSelection.filtros';
const ouvintes = new Set<() => void>();
let memoria = '';

function ler(): string {
  try {
    return sessionStorage.getItem(CHAVE) ?? memoria;
  } catch {
    return memoria; // sessão indisponível: só não lembra os filtros
  }
}

function assinar(avisar: () => void) {
  ouvintes.add(avisar);
  return () => { ouvintes.delete(avisar); };
}

function interpretar(bruto: string): FiltrosSelecao {
  try {
    const salvo = JSON.parse(bruto || 'null') as Partial<FiltrosSelecao> | null;
    if (!salvo || typeof salvo !== 'object') return FILTROS_VAZIOS;
    return {
      busca: typeof salvo.busca === 'string' ? salvo.busca : '',
      tipo: salvo.tipo === 'data' ? 'data' : 'trimestre',
      ano: typeof salvo.ano === 'string' ? salvo.ano : '',
      trimestre: typeof salvo.trimestre === 'string' ? salvo.trimestre : '',
      data: typeof salvo.data === 'string' ? salvo.data : '',
    };
  } catch {
    return FILTROS_VAZIOS;
  }
}

export function useFiltrosSalvos(): [FiltrosSelecao, (patch: Partial<FiltrosSelecao>) => void] {
  const bruto = useSyncExternalStore(assinar, ler, () => '');
  const filtros = useMemo(() => interpretar(bruto), [bruto]);
  const alterar = useCallback((patch: Partial<FiltrosSelecao>) => {
    const novo = JSON.stringify({ ...interpretar(ler()), ...patch });
    memoria = novo;
    try { sessionStorage.setItem(CHAVE, novo); } catch { /* fica só na memória */ }
    ouvintes.forEach((avisar) => avisar());
  }, []);
  return [filtros, alterar];
}

export const TRIMESTRES = [
  { valor: '1', rotulo: '1º tri', meses: 'jan–mar' },
  { valor: '2', rotulo: '2º tri', meses: 'abr–jun' },
  { valor: '3', rotulo: '3º tri', meses: 'jul–set' },
  { valor: '4', rotulo: '4º tri', meses: 'out–dez' },
];

/** Frase que confirma o recorte exibido (descreverPeriodo). */
export function descreverPeriodo(f: FiltrosSelecao): string {
  if (f.tipo === 'data' && f.data) return `com referência em ${dataBr(f.data)}`;
  if (f.tipo === 'trimestre' && f.trimestre && f.ano) return `do ${f.trimestre}º trimestre de ${f.ano}`;
  if (f.ano) return `de todo o ano de ${f.ano}`;
  return 'de todos os períodos';
}
