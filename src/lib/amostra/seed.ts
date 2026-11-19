/**
 * Seed da amostra (selecao.py do Bate Lastro): 12 caracteres em Base32 de Crockford, sem I, L, O
 * e U, para ser ditada sem ambiguidade, no formato XXXX-XXXX-XXXX. Sem dependências do Node:
 * a tela de "Conferir seed" usa a mesma normalização no navegador.
 */

export const ALFABETO_SEED = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function formatarSeed(texto: string): string {
  return `${texto.slice(0, 4)}-${texto.slice(4, 8)}-${texto.slice(8)}`;
}

/** Seed digitada → formato canônico, ou null se não for uma seed válida (O→0, I/L→1). */
export function normalizarSeedOuNull(seed: string): string | null {
  const texto = String(seed).trim().toUpperCase().replace(/[-\s]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (texto.length !== 12 || [...texto].some((c) => !ALFABETO_SEED.includes(c))) return null;
  return formatarSeed(texto);
}

/** Seed aleatória de 60 bits (`gerar_seed`). `aleatorio` devolve 8 bytes aleatórios. */
export function seedDeBytes(bytes: Uint8Array): string {
  let n = 0n;
  for (let i = 0; i < 8; i++) n = (n << 8n) | BigInt(bytes[i] ?? 0);
  n &= (1n << 60n) - 1n;
  let texto = '';
  for (let i = 11; i >= 0; i--) texto += ALFABETO_SEED[Number((n >> BigInt(5 * i)) & 31n)];
  return formatarSeed(texto);
}
