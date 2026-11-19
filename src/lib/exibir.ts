import { CAMPO_POR_ID, type CampoId } from '@/lib/campos';
import { formatarCpfCnpj } from '@/lib/texto';
import { formatarData, formatarMoeda, moedaDigitada } from '@/lib/valores';

/** Valor de um campo para a tela (moeda em R$, data dd/mm/aaaa, CPF/CNPJ com máscara). */
export function exibirValor(campo: CampoId, valor: string | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '';
  const def = CAMPO_POR_ID[campo];
  if (def.tipo === 'moeda') return formatarMoeda(valor);
  if (def.tipo === 'data') return formatarData(valor);
  if (def.tipo === 'pessoa' || campo === 'doc_cessionario') {
    const d = valor.replace(/\D/g, '');
    return d.length === 11 || d.length === 14 ? formatarCpfCnpj(d) : valor;
  }
  return valor;
}

/**
 * O que a pessoa digitou como "valor no documento" (D) → valor gravado:
 * moeda "1.400,00" → "1400.00"; data já vem ISO do <input type="date">;
 * o resto como digitado. null = inválido.
 */
export function valorDigitadoParaGravar(campo: CampoId, digitado: string): string | null {
  const t = digitado.trim();
  if (!t) return '';
  const def = CAMPO_POR_ID[campo];
  if (def.tipo === 'moeda') return moedaDigitada(t);
  if (def.tipo === 'data') return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
  return t;
}

/** Valor gravado → texto do campo de edição. */
export function valorParaEditar(campo: CampoId, valor: string | null | undefined): string {
  if (!valor) return '';
  const def = CAMPO_POR_ID[campo];
  if (def.tipo === 'moeda') return formatarMoeda(valor).replace('R$ ', '');
  return valor;
}
