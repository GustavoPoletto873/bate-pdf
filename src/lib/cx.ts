/** Junta classes CSS ignorando as vazias. Fica fora do 'use client' para servir também ao servidor. */
export function cx(...classes: (string | false | null | undefined)[]) {
  return classes.filter(Boolean).join(' ');
}
