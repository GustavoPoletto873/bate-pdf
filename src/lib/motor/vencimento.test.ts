/** Porta de backend/tests/test_vencimento_ajustado.py (só a escolha da coluna; o resto do upload é do app). */
import { describe, expect, test } from 'vitest';
import { colunasDeVencimento, completarVencimento } from './vencimento';

describe('vencimento da amostra', () => {
  test('vale a coluna escolhida e a vazia usa a outra', () => {
    const linhas = [
      { DATA_VENCIMENTO_ORIGINAL: '21/06/2026', DATA_VENCIMENTO_AJUSTADA: '22/06/2026' },
      { DATA_VENCIMENTO_ORIGINAL: '', DATA_VENCIMENTO_AJUSTADA: '22/07/2026' },
    ];
    const r = completarVencimento(linhas, ['DATA_VENCIMENTO_ORIGINAL', 'DATA_VENCIMENTO_AJUSTADA']);
    expect(r.linhas.map((l) => l.DATA_VENCIMENTO_ORIGINAL)).toEqual(['21/06/2026', '22/07/2026']);
    expect(r.origem).toEqual({ escolhida: 'DATA_VENCIMENTO_ORIGINAL', linhas: { 1: 'DATA_VENCIMENTO_AJUSTADA' } });
    expect(r.mapeamento).toBeNull();
  });

  test('escolha da ajustada na tela é respeitada', () => {
    const linhas = [
      { DATA_VENCIMENTO_ORIGINAL: '21/06/2026', 'Data Vencimento Ajustada': '22/06/2026' },
      { DATA_VENCIMENTO_ORIGINAL: '21/07/2026', 'Data Vencimento Ajustada': '' },
    ];
    const mapa = { 'Data Vencimento Ajustada': 'DATA_VENCIMENTO_ORIGINAL' };
    const r = completarVencimento(linhas, ['DATA_VENCIMENTO_ORIGINAL', 'Data Vencimento Ajustada'], mapa);
    expect(r.linhas.map((l) => l['Data Vencimento Ajustada'])).toEqual(['22/06/2026', '21/07/2026']);
    expect(r.origem.escolhida).toBe('Data Vencimento Ajustada');
    expect(r.origem.linhas).toEqual({ 1: 'DATA_VENCIMENTO_ORIGINAL' });
    expect(r.mapeamento).toEqual(mapa);
  });

  test('sem vencimento mapeado a coluna de vencimento assume', () => {
    const linhas = [{ DATA_VENCIMENTO_AJUSTADA: '22/06/2026' }];
    const r = completarVencimento(linhas, ['DATA_VENCIMENTO_AJUSTADA']);
    expect(r.linhas.map((l) => l.DATA_VENCIMENTO_ORIGINAL)).toEqual(['22/06/2026']);
    expect(r.origem.escolhida).toBe('DATA_VENCIMENTO_AJUSTADA');
    expect(completarVencimento(linhas, ['DATA_VENCIMENTO_AJUSTADA'], { OUTRA: 'NOME_SACADO' }).mapeamento!.DATA_VENCIMENTO_AJUSTADA)
      .toBe('DATA_VENCIMENTO_ORIGINAL');
  });

  test('coluna de valor de vencimento não conta', () => {
    expect(colunasDeVencimento(['VALOR_VENCIMENTO_ORIGINAL', 'DATA_VENCIMENTO_AJUSTADA'])).toEqual(['DATA_VENCIMENTO_AJUSTADA']);
  });

  test('planilha só com a original não muda', () => {
    const r = completarVencimento([{ DATA_VENCIMENTO_ORIGINAL: '21/06/2026' }], ['DATA_VENCIMENTO_ORIGINAL']);
    expect(r.linhas[0].DATA_VENCIMENTO_ORIGINAL).toBe('21/06/2026');
    expect(r.origem.linhas).toEqual({});
  });
});
