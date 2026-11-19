import { describe, expect, it } from 'vitest';
import {
  alertaCnpj, amostraDoPeriodo, anteriorDoHistorico, cnpjsDoNome, ehEstoque, ehLiquidados, fundosParecidos, montarLote,
  periodosDaDataBase, regraSugerida, resumoCsv, trimestreAnterior,
} from './arquivos';

const fundos = [
  { id: 1, nome: 'FIDC Beta', cnpj: '22222222000122', administradora: 'ID CTVM' },
  { id: 2, nome: 'FIDC Alfa', cnpj: '11111111000111', administradora: 'PLANNER' },
];
const arquivo = (name: string) => ({ name, size: 1 });

describe('nomes dos arquivos', () => {
  it('estoque, liquidados e CNPJ no nome', () => {
    expect(ehEstoque('Estoque_X.csv')).toBe(true);
    expect(ehEstoque('Conciliação.xlsx')).toBe(true);
    expect(ehLiquidados('LiquidadosEBaixados.csv')).toBe(true);
    expect(ehEstoque('Liquidados_estoque.csv')).toBe(false);
    expect(ehEstoque('Aquisicao.xlsx')).toBe(false);
    expect(cnpjsDoNome('11.111.111/0001-11 Estoque')).toEqual(['11111111000111']);
    expect(alertaCnpj('22222222000122_Estoque.csv', fundos[1])).toMatch(/22\.222\.222\/0001-22, diferente/);
    expect(alertaCnpj('11111111000111_Estoque.csv', fundos[1])).toBeNull();
  });
});

describe('período', () => {
  it('padrão = último trimestre fechado', () => {
    expect(trimestreAnterior(new Date(2026, 10, 19))).toEqual({ dataDe: '2026-07-01', dataAte: '2026-09-30' });
    expect(trimestreAnterior(new Date(2026, 1, 10))).toEqual({ dataDe: '2025-10-01', dataAte: '2025-12-31' });
  });
  it('data-base no meio do trimestre sugere o mês; no fechamento, o trimestre', () => {
    expect(periodosDaDataBase('2026-08-31').sugerido).toEqual({ dataDe: '2026-08-01', dataAte: '2026-08-31' });
    expect(periodosDaDataBase('2026-09-30').sugerido).toEqual({ dataDe: '2026-07-01', dataAte: '2026-09-30' });
    expect(periodosDaDataBase('2026-08-15').trimestre).toEqual({ dataDe: '2026-07-01', dataAte: '2026-08-15' });
  });
});

describe('lote', () => {
  it('casa pelo CNPJ do nome, separa liquidados e deixa de fora o que não casa', () => {
    const arquivos = [
      arquivo('22222222000122_Estoque_Beta.xlsx'), arquivo('11.111.111-0001-11 Estoque Alfa.csv'),
      arquivo('11111111000111_LiquidadosEBaixados_Alfa.csv'), arquivo('99999999000199_Estoque_Outro.xlsx'),
      arquivo('Estoque_sem_cnpj.xlsx'), arquivo('Aquisicao_11111111000111.xlsx'),
    ];
    const { linhas, semFundo, naoReconhecidos } = montarLote(arquivos, fundos);
    expect(linhas.map((l) => [l.fundo.nome, l.estoques.length, l.liquidados.length])).toEqual([['FIDC Alfa', 1, 1], ['FIDC Beta', 1, 0]]);
    expect(semFundo.map((a) => a.name)).toEqual(['99999999000199_Estoque_Outro.xlsx', 'Estoque_sem_cnpj.xlsx']);
    expect(naoReconhecidos.map((a) => a.name)).toEqual(['Aquisicao_11111111000111.xlsx']);
  });

  it('pelo conteúdo: liquidação sem CNPJ vai para o fundo do estoque com o mesmo nome; nome repetido não decide', () => {
    const estoque = arquivo('11111111000111_Estoque_Alfa.csv');
    const liq = arquivo('LiquidadosEBaixados_ALFA.csv');
    const conteudos = new Map([[estoque, { nome: 'ALFA FUNDO', cnpj: '11111111000111' }], [liq, { nome: 'ALFA FUNDO', cnpj: null }]]);
    const r = montarLote([estoque, liq], fundos, { conteudos });
    expect(r.linhas[0].liquidados).toEqual([liq]);
    expect([...r.pelaLeitura]).toEqual([liq]);
    const beta = arquivo('22222222000122_Estoque_Beta.csv');
    const repetido = new Map([[estoque, { nome: 'X', cnpj: null }], [beta, { nome: 'X', cnpj: null }], [liq, { nome: 'X', cnpj: null }]]);
    expect(montarLote([estoque, beta, liq], fundos, { conteudos: repetido }).semFundo).toEqual([liq]);
    expect(montarLote([estoque, beta, liq], fundos, { conteudos: repetido, escolhas: new Map([[liq, 2]]) }).semFundo).toEqual([]);
  });

  it('fundos parecidos, histórico, regra e resumo CSV', () => {
    const lista = [{ id: 1, nome: 'AXEN FIDC', cnpj: '1' }, { id: 2, nome: 'ALZ FIDC', cnpj: '2' }, { id: 3, nome: 'AGRO REAL FIDC FIAGRO', cnpj: '3' }];
    expect(fundosParecidos('ALZ FUNDO DE INVESTIMENTO EM DIREITOS CREDITORIOS', lista).map((f) => f.id)).toEqual([2, 3, 1]);
    const historico = [
      { id: 1, status: 'GERADA', data_de: '2026-01-01', data_ate: '2026-03-31' },
      { id: 2, status: 'GERADA', data_de: '2026-04-01', data_ate: '2026-06-30' },
      { id: 3, status: 'DESCARTADA', data_de: '2026-04-01', data_ate: '2026-06-30' },
    ];
    expect(amostraDoPeriodo(historico, '2026-04-01', '2026-06-30')?.id).toBe(2);
    expect(anteriorDoHistorico(historico, '2026-07-01')?.id).toBe(2);
    expect(anteriorDoHistorico(historico, '2026-01-01')).toBeNull();
    const { linhas } = montarLote([arquivo('11111111000111_Estoque.xlsx'), arquivo('22222222000122_Estoque.xlsx')], fundos);
    expect(regraSugerida(linhas)).toBe('padrao');
    expect(regraSugerida(linhas.filter((l) => l.fundo.id === 2))).toBe('planner');
    const csv = resumoCsv(linhas, { 2: { estado: 'gerada', rotulo: 'Gerada', amostra: { seed: 'AAAA-BBBB-CCCC', total_titulos: 35 } } });
    expect(csv.split('\r\n')[1]).toBe('"FIDC Alfa";"11.111.111/0001-11";"Gerada";"AAAA-BBBB-CCCC";"35";""');
    expect(csv.split('\r\n')[2]).toBe('"FIDC Beta";"22.222.222/0001-22";"Não gerada";"";"";""');
  });
});
