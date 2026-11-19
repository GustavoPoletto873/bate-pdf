'use client';

import { useEffect, useState } from 'react';
import { ErroApi } from '@/lib/cliente';

/** O valor só muda depois de `ms` sem alteração (busca enquanto digita). */
export function useAtrasado<T>(valor: T, ms: number): T {
  const [atrasado, setAtrasado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setAtrasado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return atrasado;
}

/** Máscara do CNPJ enquanto digita: "11222333" → "11.222.333". */
export function mascaraCnpj(digitado: string): string {
  const d = digitado.replace(/\D/g, '').slice(0, 14);
  const partes = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 8), d.slice(8, 12), d.slice(12, 14)];
  let s = partes[0];
  if (partes[1]) s += `.${partes[1]}`;
  if (partes[2]) s += `.${partes[2]}`;
  if (partes[3]) s += `/${partes[3]}`;
  if (partes[4]) s += `-${partes[4]}`;
  return s;
}

export const rotuloTipo = (tipo: string) => (tipo === 'FIC_FIDC' ? 'FIC FIDC' : 'FIDC');

/** Mensagem da API (ErroApi) ou uma genérica que diz o que fazer. */
export function mensagemDeErro(e: unknown, padrao: string): string {
  return e instanceof ErroApi && e.message ? e.message : padrao;
}
