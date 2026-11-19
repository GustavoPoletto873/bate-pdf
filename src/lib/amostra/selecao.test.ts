import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  chave, comparar, documento, GRUPO_ADQUIRIDOS, GRUPO_MAIORES, GRUPO_MAIORES_RECOMPRAS, GRUPO_VENCIDOS, nota, normalizarSeed,
  selecionar, type Parametros, type TituloCanonico,
} from './selecao';
import { normalizarSeedOuNull, seedDeBytes } from './seed';

// Dados fictícios.
let seq = 0;
function titulo(c: Partial<TituloCanonico>): TituloCanonico {
  seq++;
  return {
    NOME_FUNDO: 'FIDC FICTICIO', NOME_CEDENTE: 'CEDENTE', DOC_CEDENTE: '11.111.111/0001-11', NOME_SACADO: 'SACADO', DOC_SACADO: '-',
    SEU_NUMERO: `S${seq}`, NU_DOCUMENTO: `N${seq}`, TIPO_RECEBIVEL: 'DM', VALOR_NOMINAL: '100.00', VALOR_PRESENTE: '100.00',
    VALOR_AQUISICAO: '90.00', DATA_VENCIMENTO_ORIGINAL: '', DATA_VENCIMENTO_AJUSTADA: '', DATA_EMISSAO: '', DATA_AQUISICAO: '',
    CHAVE_NFE: '-', ...c,
  };
}
const P: Parametros = { data_de: '2026-07-01', data_ate: '2026-09-30', limite_adquiridos: 120, limite_vencidos: 120, regra: 'padrao' };
const SEED = 'AAAA-BBBB-CCCC';

describe('seed', () => {
  it('normaliza O/I/L e o formato', () => {
    expect(normalizarSeed('aaaa bbbb cccc')).toBe(SEED);
    expect(normalizarSeedOuNull('0O1I-L234-5678')).toBe('0011-1234-5678');
    expect(normalizarSeedOuNull('AAAA-BBBB-CCCU')).toBeNull();
    expect(() => normalizarSeed('curta')).toThrow(/Seed inválida/);
  });
  it('gera 12 caracteres Crockford de 60 bits', () => {
    expect(seedDeBytes(new Uint8Array(8))).toBe('0000-0000-0000');
    expect(seedDeBytes(new Uint8Array(8).fill(255))).toBe('ZZZZ-ZZZZ-ZZZZ');
  });
});

describe('nota e chave', () => {
  it('nota = sha256("amostragem-v1|seed|grupo|chave"), igual ao Bate Lastro', () => {
    const esperado = createHash('sha256').update('amostragem-v1|AAAA-BBBB-CCCC|Adquiridos no Tri|11111111000111|N1|S1').digest('hex');
    expect(nota(SEED, GRUPO_ADQUIRIDOS, '11111111000111|N1|S1')).toBe(esperado);
  });
  it('documento sem máscara e sem zeros à esquerda', () => {
    expect(documento('01.234.567/0001-89')).toBe('1234567000189');
    expect(documento('-')).toBe('-');
    expect(chave({ DOC_CEDENTE: '00.111', NU_DOCUMENTO: 'X', SEU_NUMERO: 'Y' })).toBe('111|X|Y');
  });
});

describe('selecionar', () => {
  // 7 cedentes, de 1 a 7 títulos grandes cada; vários adquiridos e vencidos no trimestre.
  const populacao: TituloCanonico[] = [];
  for (let c = 1; c <= 7; c++) {
    for (let i = 0; i < 4; i++) {
      populacao.push(titulo({ DOC_CEDENTE: String(c).repeat(14), VALOR_PRESENTE: `${c * 1000 + i}.00` }));
    }
  }
  for (let i = 0; i < 40; i++) populacao.push(titulo({ DOC_CEDENTE: '99999999000199', VALOR_PRESENTE: '1.00', DATA_AQUISICAO: '2026-08-10' }));
  for (let i = 0; i < 30; i++) populacao.push(titulo({ DOC_CEDENTE: '88888888000188', VALOR_PRESENTE: '2.00', DATA_VENCIMENTO_AJUSTADA: '2026-09-01' }));
  // Vencido no próprio dia de início não entra (início exclusivo); adquirido no dia entra.
  populacao.push(titulo({ DOC_CEDENTE: '77777777000177', VALOR_PRESENTE: '0.01', DATA_VENCIMENTO_AJUSTADA: '2026-07-01', NU_DOCUMENTO: 'VENC-INICIO' }));
  populacao.push(titulo({ DOC_CEDENTE: '77777777000177', VALOR_PRESENTE: '0.01', DATA_AQUISICAO: '2026-07-01', NU_DOCUMENTO: 'AQ-INICIO' }));

  it('5 maiores cedentes × 3 maiores títulos, depois os sorteios', () => {
    const r = selecionar(populacao, { ...P, limite_adquiridos: 25, limite_vencidos: 10 }, SEED);
    const maiores = r.filter((i) => i.grupo === GRUPO_MAIORES);
    expect(maiores).toHaveLength(15);
    expect(maiores.map((i) => i.titulo.VALOR_PRESENTE).slice(0, 3)).toEqual(['7003.00', '7002.00', '7001.00']);
    expect(new Set(maiores.map((i) => documento(i.titulo.DOC_CEDENTE)))).toEqual(new Set(['77777777777777', '66666666666666', '55555555555555', '44444444444444', '33333333333333']));
    expect(maiores.every((i) => i.nota === '')).toBe(true);
    expect(r.filter((i) => i.grupo === GRUPO_ADQUIRIDOS)).toHaveLength(10); // 25 − 15
    expect(r.filter((i) => i.grupo === GRUPO_VENCIDOS)).toHaveLength(10);
    expect(r.some((i) => i.titulo.NU_DOCUMENTO === 'VENC-INICIO')).toBe(false);
    const adq = r.filter((i) => i.grupo === GRUPO_ADQUIRIDOS).map((i) => i.nota);
    expect([...adq].sort()).toEqual(adq);
  });

  it('não depende da ordem das linhas', () => {
    const a = selecionar(populacao, P, SEED);
    const b = selecionar([...populacao].reverse(), P, SEED);
    expect(comparar(a, b)).toEqual([]);
    // Outra seed, com limite menor que o pool: outra amostra.
    const d = selecionar(populacao, { ...P, limite_adquiridos: 20 }, SEED);
    const e = selecionar(populacao, { ...P, limite_adquiridos: 20 }, 'ZZZZ-ZZZZ-ZZZZ');
    expect(comparar(d, e)).not.toEqual([]);
  });

  it('saldo não positivo ou maior que o pool: entram todos os adquiridos', () => {
    const r = selecionar(populacao, { ...P, limite_adquiridos: 10 }, SEED);
    expect(r.filter((i) => i.grupo === GRUPO_ADQUIRIDOS)).toHaveLength(41);
  });

  it('amostra anterior sai só dos Maiores Cedentes', () => {
    const base = selecionar(populacao, { ...P, limite_adquiridos: 25 }, SEED);
    const tirar = base.filter((i) => i.grupo === GRUPO_MAIORES).slice(0, 2).map((i) => i.chave);
    const adqChave = base.find((i) => i.grupo === GRUPO_ADQUIRIDOS)!.chave;
    const r = selecionar(populacao, { ...P, limite_adquiridos: 25 }, SEED, [...tirar, adqChave]);
    expect(r.filter((i) => i.grupo === GRUPO_MAIORES)).toHaveLength(13);
    expect(r.filter((i) => i.grupo === GRUPO_ADQUIRIDOS)).toHaveLength(12);
    expect(r.some((i) => i.chave === adqChave)).toBe(true);
  });

  it('recompras dos liquidados entram na frente e contam no saldo', () => {
    const liquidados = [titulo({ DOC_CEDENTE: '12312312000112', VALOR_PRESENTE: '50.00' }), populacao[27]];
    const r = selecionar(populacao, { ...P, limite_adquiridos: 25 }, SEED, [], liquidados);
    expect(r[0].grupo).toBe(GRUPO_MAIORES_RECOMPRAS);
    expect(r.filter((i) => i.grupo === GRUPO_MAIORES_RECOMPRAS)).toHaveLength(2);
    // O título que está nos dois entra uma vez só, como recompra.
    expect(r.filter((i) => i.chave === chave(populacao[27]))).toHaveLength(1);
    expect(r.filter((i) => i.grupo === GRUPO_MAIORES)).toHaveLength(14);
    expect(r.filter((i) => i.grupo === GRUPO_ADQUIRIDOS)).toHaveLength(9); // 25 − 16
  });

  it('Planner: sem maiores cedentes, adquiridos e vencidos juntos até 120', () => {
    const muitos = [...populacao];
    for (let i = 0; i < 200; i++) muitos.push(titulo({ DOC_CEDENTE: '55544433000122', VALOR_PRESENTE: '3.00', DATA_AQUISICAO: '2026-09-30' }));
    const r = selecionar(muitos, { ...P, regra: 'planner' }, SEED, ['qualquer'], [titulo({ VALOR_PRESENTE: '1.00' })]);
    expect(r).toHaveLength(120);
    expect(r.some((i) => i.grupo === GRUPO_MAIORES || i.grupo === GRUPO_MAIORES_RECOMPRAS)).toBe(false);
    const notas = r.map((i) => i.nota);
    expect([...notas].sort()).toEqual(notas);
    // Os títulos dos maiores cedentes ficam fora do sorteio também no Planner.
    expect(r.some((i) => documento(i.titulo.DOC_CEDENTE) === '77777777777777')).toBe(false);
  });

  it('valida parâmetros', () => {
    expect(() => selecionar([], { ...P, data_de: '2026-10-01' }, SEED)).toThrow(/anterior ou igual/);
    expect(() => selecionar([], { ...P, limite_vencidos: -1 }, SEED)).toThrow(/inteiros não negativos/);
  });

  it('comparar acusa títulos a mais, a menos e ordem', () => {
    const a = [{ grupo: 'G', chave: 'k1', nota: 'a' }, { grupo: 'G', chave: 'k2', nota: 'b' }];
    expect(comparar(a, [...a].reverse())).toEqual(['Mesmos títulos, mas em outra ordem.']);
    expect(comparar(a, [a[0]])).toEqual(['Registrado e não refeito: G k2']);
  });
});
