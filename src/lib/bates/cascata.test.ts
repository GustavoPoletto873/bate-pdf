import { describe, expect, test } from 'vitest';
import { cascata, numeroDaCascata, numeroSemParcela, type RegistroCascata } from './cascata';
import {
  avaliarConfiabilidade, codigoAlfanumerico, compararDocumento, nomesConferem, numerosConferem, vereditoAutomatico, vereditosDoLado,
} from './comparacao';

// Dados fictícios.
const reg = (id: number, p: Partial<RegistroCascata> = {}): RegistroCascata => ({
  id, numero_documento: null, valor: null, data_vencimento: null, data_emissao: null, data_aquisicao: null,
  doc_cedente: null, doc_sacado: null, ...p,
});

describe('normalização da cascata', () => {
  test('nº = primeira sequência de dígitos sem zeros à esquerda', () => {
    expect(numeroDaCascata('NF 000123-4')).toBe('123');
    expect(numeroDaCascata('000')).toBe('0');
    expect(numeroDaCascata('ABC')).toBe('');
    expect(numeroDaCascata(null)).toBe('');
  });
  test('nº sem parcela só em número puro de 7+ dígitos terminando em 001–099', () => {
    expect(numeroSemParcela('172137001')).toBe('172137');
    expect(numeroSemParcela('0172137099')).toBe('172137');
    expect(numeroSemParcela('172137100')).toBe('');
    expect(numeroSemParcela('123001')).toBe('');
    expect(numeroSemParcela('A72137001')).toBe('');
  });
  test('código alfanumérico', () => {
    expect(codigoAlfanumerico('A001LCMG')).toBe('A001LCMG');
    expect(codigoAlfanumerico('BQPNYX/003')).toBe('BQPNYX003');
    expect(codigoAlfanumerico('NF 123')).toBeNull();
    expect(codigoAlfanumerico('DP479.1')).toBeNull();
    expect(codigoAlfanumerico('')).toBeNull();
  });
});

describe('cascata (_sync_cascata_matching)', () => {
  test('critério 1 com tudo igual; similaridade 1,0', () => {
    const base = [reg(1, { numero_documento: '123456', valor: '100.00', data_vencimento: '2026-10-10', doc_cedente: '111', doc_sacado: '222' })];
    const leit = [reg(10, { numero_documento: '00123456', valor: '100.00', data_vencimento: '2026-10-11', doc_cedente: '111', doc_sacado: '222' })];
    const r = cascata(base, leit);
    expect(r.pares).toEqual([{ base_id: 1, leitura_id: 10, criterio: 1, similaridade: 1, sem_parcela: false }]);
    expect(r.basesSemPar).toEqual([]);
  });

  test('cai no critério certo e a similaridade desce 0,1 por critério (mínimo 0,2)', () => {
    // Sem documentos: nº + valor + vencimento = critério 5.
    let r = cascata([reg(1, { numero_documento: '555', valor: 50, data_vencimento: '2026-01-01' })], [reg(2, { numero_documento: '555', valor: 50.2, data_vencimento: '2026-01-02' })]);
    expect(r.pares[0]).toMatchObject({ criterio: 5, similaridade: 0.6 });
    // Valor + aquisição + vencimento, sem nº = critério 11 (similaridade 0,2).
    r = cascata([reg(1, { valor: '80.00', data_vencimento: '2026-01-10', data_aquisicao: '2025-12-01' })], [reg(2, { valor: '80.00', data_vencimento: '2026-01-09', data_aquisicao: '2025-12-02' })]);
    expect(r.pares[0]).toMatchObject({ criterio: 11, similaridade: 0.2 });
  });

  test('valor com 0,5% de tolerância; datas ±1 dia; documento exato (sem tirar pontuação)', () => {
    const base = [reg(1, { numero_documento: '9999', valor: '1000.00', data_vencimento: '2026-05-05', doc_sacado: '123.456.789-09' })];
    expect(cascata(base, [reg(2, { numero_documento: '9999', valor: '1005.00', data_vencimento: '2026-05-06', doc_sacado: '123.456.789-09' })]).pares[0].criterio).toBe(2);
    // 1006 passa de 0,5%: nem nº+valor; sobra nº+vencimento (critério 8).
    expect(cascata(base, [reg(2, { numero_documento: '9999', valor: '1006.00', data_vencimento: '2026-05-06', doc_sacado: '12345678909' })]).pares[0].criterio).toBe(8);
    // Vencimento a 2 dias e valor diferente: nada.
    expect(cascata(base, [reg(2, { numero_documento: '9999', valor: '2000.00', data_vencimento: '2026-05-07' })]).pares).toEqual([]);
  });

  test('guloso: o primeiro título pega o primeiro candidato, e os dois saem do jogo', () => {
    const base = [reg(1, { numero_documento: '777', valor: '10.00' }), reg(2, { numero_documento: '777', valor: '10.00' })];
    const leit = [reg(20, { numero_documento: '777', valor: '10.00' }), reg(21, { numero_documento: '777', valor: '10.00' })];
    const r = cascata(base, leit);
    expect(r.pares.map((p) => [p.base_id, p.leitura_id])).toEqual([[1, 20], [2, 21]]);
  });

  test('chave curta de dentro de um código não identifica o título sozinha', () => {
    // 'A001LCMG' e 'A001YVM0' viram ambos '1': com só nº + valor, não casam.
    const base = [reg(1, { numero_documento: 'A001LCMG', valor: '10.00' })];
    expect(cascata(base, [reg(2, { numero_documento: 'A001YVM0', valor: '10.00' })]).pares).toEqual([]);
    // Um é o outro com a parcela no fim: vale.
    expect(cascata(base, [reg(2, { numero_documento: 'A001LCMG001', valor: '10.00' })]).pares).toHaveLength(1);
    // Com valor + vencimento juntos, o nº curto basta.
    expect(cascata([reg(1, { numero_documento: 'A001LCMG', valor: 10, data_vencimento: '2026-01-01' })],
      [reg(2, { numero_documento: 'A001YVM0', valor: 10, data_vencimento: '2026-01-01' })]).pares[0].criterio).toBe(5);
  });

  test('2ª passada: nº da base sem a parcela, só com valor', () => {
    const base = [reg(1, { numero_documento: '172137001', valor: '300.00' })];
    const r = cascata(base, [reg(2, { numero_documento: '172137', valor: '300.00' })]);
    expect(r.pares[0]).toMatchObject({ criterio: 7, sem_parcela: true });
    expect(cascata(base, [reg(2, { numero_documento: '172137', valor: '999.00' })]).pares).toEqual([]);
  });

  test('documento vazio dos dois lados não é documento igual', () => {
    const r = cascata([reg(1, { valor: '10.00', data_vencimento: '2026-01-01' })], [reg(2, { valor: '10.00', data_vencimento: '2026-01-01' })]);
    expect(r.pares).toEqual([]); // critério 11 exige aquisição, os outros nº ou sacado
  });
});

describe('comparações', () => {
  test('comparar_documento', () => {
    expect(compararDocumento('A030-81962', 'a03081962')).toBe('V');
    expect(compararDocumento('123', 'N/A')).toBe('P');
    expect(compararDocumento('10475/D', '10475')).toBe('D');
  });

  test('calc_divergencia por tipo de campo', () => {
    const t = { numero_documento: '123', sacado_nome: 'JOAO', sacado_documento: '12345678909', valor_total: '1500.00', data_vencimento: '2026-10-10', nome_fundo: 'FIDC X', cnpj_fundo: '12345678000195' };
    expect(vereditoAutomatico('valor_total', t, { valor_total: '1500' })).toBe('V');
    expect(vereditoAutomatico('valor_total', t, { valor_total: '0' })).toBe('P');
    expect(vereditoAutomatico('data_vencimento', t, { data_vencimento: '2026-10-11' })).toBe('D');
    expect(vereditoAutomatico('sacado_nome', t, { sacado_nome: ' JOAO ' })).toBe('V');
    expect(vereditoAutomatico('sacado_documento', t, { sacado_documento: '123.456.789-09' })).toBe('D');
    expect(vereditoAutomatico('doc_cessionario', t, { doc_cessionario: '12.345.678/0001-95' })).toBe('V');
    // Decisão salva vale mais.
    expect(vereditosDoLado('lastro', t, { valor_total: '1500' }, { valor_total: 'D' }).valor_total).toBe('D');
    expect(Object.keys(vereditosDoLado('termo', t, {}))).toHaveLength(11);
  });

  test('confiabilidade x/5', () => {
    const base = { numero_documento: '123456', valor_nominal: '1000.00', data_vencimento: '2026-10-10', nome_cedente: 'EMPRESA FICTICIA LTDA', doc_cedente: '11.222.333/0001-81', nome_sacado: 'FLAVIO CORREA DE MELO', doc_sacado: null };
    const leitura = { numero_documento: '123456/01', valor_nominal: '1004.00', data_vencimento: '2026-10-11', nome_cedente: 'OUTRA', doc_cedente: '11222333000181', nome_sacado: 'FLAVIO CORREA DE MEL', doc_sacado: '12345678909' };
    const c = avaliarConfiabilidade(base, leitura);
    expect(c.conferem).toBe(5);
    expect(c.percentual).toBe(100);
    const c2 = avaliarConfiabilidade(base, { ...leitura, valor_nominal: '2000', nome_sacado: 'MARIA' });
    expect(c2.percentual).toBe(60);
    expect(c2.campos.find((x) => x.campo === 'Sacado')!.confere).toBe(false);
  });

  test('nomes e números', () => {
    expect(nomesConferem('JOSE DA SILVA SANTOS', 'SANTOS SILVA JOSE')).toBe(true);
    expect(nomesConferem('JOSE', 'JOSE SILVA')).toBe(false);
    expect(numerosConferem('A001LCMG', 'A001YVM0')).toBe(false);
    expect(numerosConferem('NF 1234', '1234')).toBe(true);
  });
});
