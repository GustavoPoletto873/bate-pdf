/**
 * Normalização de texto "sem acento, sem caixa" — porta de
 * backend/utils/texto_normalizado.py do Bate Lastro.
 *
 * Cada caractere vira o primeiro ponto de código da sua decomposição NFD, em
 * minúsculas. O comprimento da string NÃO muda: a busca recorta o trecho do
 * texto original no mesmo deslocamento em que achou o termo no normalizado, e
 * o motor de pré-classificação guarda posições no texto normalizado.
 *
 * Em JS o comprimento é medido em unidades UTF-16; caracteres fora do BMP
 * (emoji) passam inalterados, preservando o comprimento também.
 */

const cache = new Map<string, string>();

function normalizarCaractere(c: string): string {
  let n = cache.get(c);
  if (n === undefined) {
    const base = c.normalize('NFD')[0] ?? c;
    const minuscula = base.toLowerCase();
    // toLowerCase pode crescer em casos raros; nunca deixar o comprimento mudar.
    n = minuscula.length === c.length ? minuscula : c;
    cache.set(c, n);
  }
  return n;
}

export function normalizarTexto(texto: string | null | undefined): string {
  if (!texto) return '';
  // Caminho rápido: ASCII puro só precisa de lower().
  if (/^[\x00-\x7f]*$/.test(texto)) return texto.toLowerCase();
  let saida = '';
  for (let i = 0; i < texto.length; i++) {
    const codigo = texto.charCodeAt(i);
    if (codigo < 0x80) {
      saida += texto[i].toLowerCase();
    } else if (codigo >= 0xd800 && codigo <= 0xdbff && i + 1 < texto.length) {
      saida += texto[i] + texto[i + 1];
      i++;
    } else {
      saida += normalizarCaractere(texto[i]);
    }
  }
  return saida;
}

/** Só dígitos. */
export function digitos(valor: unknown): string {
  return String(valor ?? '').replace(/\D/g, '');
}

/** CPF (11) ou CNPJ (14) com máscara; outro tamanho volta como veio. */
export function formatarCpfCnpj(valor: unknown): string {
  const d = digitos(valor);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return String(valor ?? '');
}
