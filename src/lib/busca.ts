import { CAMPO_POR_ID, documentoParaBusca, type CampoId } from '@/lib/campos';

/**
 * Formas em que um valor costuma estar impresso no PDF — para o clique num
 * campo procurar o valor nos PDFs da base (termosDeBusca/buscaDoCampo do
 * preClassificacao.js e services/formas_impressao.py do Bate Lastro).
 * A busca é substring no texto normalizado (sem acento, minúsculo), mínimo 3
 * caracteres. A primeira forma que achar algo vence.
 */
export function termosDeBusca(campo: CampoId, valor: string | null | undefined): string[] {
  const bruto = String(valor ?? '').replace(/\s+/g, ' ').trim();
  if (!bruto || bruto === '-') return [];
  const def = CAMPO_POR_ID[campo];
  const termos: string[] = [];
  const add = (t: string | null | undefined) => {
    const v = (t ?? '').trim();
    if (v.length >= 3 && !termos.includes(v)) termos.push(v);
  };

  if (def.tipo === 'pessoa' || campo === 'doc_cessionario') {
    const d = bruto.replace(/\D/g, '');
    if (d.length === 11) add(d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'));
    if (d.length === 14) add(d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5'));
    add(d);
    // CPF que perdeu o zero à esquerda na planilha.
    if (d.length === 10) add(`0${d}`.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4'));
    return termos;
  }
  if (def.tipo === 'moeda') {
    const m = /^(-?\d+)(?:\.(\d{1,2}))?$/.exec(bruto);
    if (m) {
      const inteiro = m[1];
      const centavos = (m[2] ?? '').padEnd(2, '0');
      add(`${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${centavos}`);
      add(`${inteiro},${centavos}`);
      add(`${inteiro}.${centavos}`);
      add(`${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${centavos}`);
    } else add(bruto);
    return termos;
  }
  if (def.tipo === 'data') {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(bruto);
    if (m) {
      const [, a, mes, d] = m;
      add(`${d}/${mes}/${a}`);
      add(`${d}.${mes}.${a}`);
      add(`${d}-${mes}-${a}`);
      add(`${d}/${mes}/${a.slice(2)}`);
      add(`${a}-${mes}-${d}`);
    } else add(bruto);
    return termos;
  }
  if (def.tipo === 'documento') {
    const impresso = documentoParaBusca(bruto);
    add(impresso);
    const semZeros = impresso.replace(/^0+/, '');
    add(semZeros);
    const soDigitos = impresso.replace(/\D/g, '');
    if (soDigitos !== impresso && soDigitos.length >= 6) add(soDigitos);
    return termos;
  }
  // Nome: inteiro, depois as duas primeiras palavras (abreviação/quebra de linha no PDF).
  add(bruto);
  const palavras = bruto.split(' ').filter((p) => p.length > 1);
  if (palavras.length > 2) add(palavras.slice(0, 2).join(' '));
  return termos;
}
