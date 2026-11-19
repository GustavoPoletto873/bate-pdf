import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Banco temporário; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'lastro-blacklist-'));
let bl: typeof import('@/lib/blacklist');
let dbMod: typeof import('@/lib/db');

function base(id: string, cnpj: string, dataRef: string, titulos: [string, string, string, string | null][]) {
  const c = dbMod.db();
  const ts = new Date().toISOString();
  c.prepare("INSERT INTO bases (id, nome, nome_fundo, cnpj_fundo, origem, criado_em, atualizado_em, data_referencia) VALUES (?, ?, 'FIDC FICTICIO', ?, 'amostra', ?, ?, ?)")
    .run(id, id, cnpj, ts, ts, dataRef);
  for (const [ced, sac, valor, aq] of titulos) {
    c.prepare('INSERT INTO titulos (base_id, numero_documento, cedente_documento, sacado_documento, valor_total, valor_aquisicao) VALUES (?, ?, ?, ?, ?, ?)')
      .run(id, 'N', ced, sac, valor, aq);
  }
}

beforeAll(async () => {
  dbMod = await import('@/lib/db');
  bl = await import('@/lib/blacklist');
});

describe('documento e lista colada', () => {
  it('normaliza CPF/CNPJ com zeros à esquerda', () => {
    expect(bl.normalizarDocumento('123.456.789-09')).toBe('12345678909');
    expect(bl.normalizarDocumento('1234567000189')).toBe('01234567000189');
    expect(bl.normalizarDocumento('123')).toBe('00000000123');
    expect(bl.normalizarDocumento('111.111.111-11')).toBe('');
    expect(bl.normalizarDocumento('123456789012345')).toBe('');
  });
  it('interpreta a lista do Excel', () => {
    expect(bl.interpretarLista('Nome\tDOC\nEMPRESA X LTDA\t48.338.212/0001-00\nFULANA;151.853.956-48\nBELTRANO - 123.456.789-09\nsem doc')).toEqual([
      { nome: 'EMPRESA X LTDA', documento: '48.338.212/0001-00' },
      { nome: 'FULANA', documento: '151.853.956-48' },
      { nome: 'BELTRANO', documento: '123.456.789-09' },
      { nome: 'sem doc', documento: '' },
    ]);
  });
});

describe('cadastro e varredura', () => {
  it('cadastra, varre o histórico, mostra a base mais recente de cada fundo e o alerta da base', () => {
    base('b1', '12.345.678/0001-95', '2026-06-30', [['48338212000100', '12345678909', '100.00', '90.00'], ['1', '2', '300.00', '300.00']]);
    base('b2', '12345678000195', '2026-09-30', [['48.338.212/0001-00', '48338212000100', '50.00', '40.00'], ['9', '9', '150.00', '160.00']]);
    const e = bl.criar('EMPRESA X LTDA', '48.338.212/0001-00');
    expect(e).toMatchObject({ documento: '48338212000100', tipo_documento: 'CNPJ', documento_formatado: '48.338.212/0001-00' });
    expect(() => bl.criar('Outra', '48338212000100')).toThrow(/já cadastrado/);
    expect(() => bl.criar('', '48338212000100')).toThrow(/Informe o nome/);

    const [item] = bl.listar();
    // Só a base mais recente do fundo (b2): a linha com a entidade nos dois papéis conta uma vez.
    expect(item.ocorrencias).toMatchObject({ total_fundos: 1, total_linhas: 1, linhas_cedente: 1, linhas_sacado: 1, valor_nominal: 50, papeis: ['cedente', 'sacado'] });
    expect(item.ocorrencias.percentual_nominal).toBeCloseTo(0.25);
    expect(item.ocorrencias.fundos[0]).toMatchObject({ base_id: 'b2', fundo_chave: '12345678000195' });

    expect(bl.historico(e.id).bases.map((b) => b.base_id)).toEqual(['b1', 'b2']);
    expect(bl.alertaDaBase('b2').map((a) => [a.papel, a.linhas, a.valor_nominal])).toEqual([['cedente', 1, 50], ['sacado', 1, 50]]);
    expect(bl.alertaDaBase('nao-existe')).toEqual([]);
  });

  it('varrerBase acha a entidade numa base nova e é idempotente; base de outro caminho é varrida ao listar', () => {
    base('b3', '99999999000199', '2026-09-30', [['48338212000100', '1', '10.00', null]]);
    expect(bl.varrerBase('b3')).toEqual({ ocorrencias: 1 });
    expect(bl.varrerBase('b3')).toEqual({ ocorrencias: 0 });
    expect(bl.varrerBase('nao-existe')).toEqual({ ocorrencias: 0 });
    base('b4', '77777777000177', '2026-09-30', [['1', '48338212000100', '5.00', null]]);
    const [item] = bl.listar();
    expect(item.ocorrencias.total_fundos).toBe(3);
    expect(item.ocorrencias.novas_7d).toBe(2);
    // Dentro da transação de quem chamou também funciona.
    dbMod.transacao(() => {
      base('b5', '66666666000166', '2026-09-30', [['48338212000100', '1', '1.00', null]]);
      expect(bl.varrerBase('b5').ocorrencias).toBe(1);
    });
  });

  it('lote com erros por linha, reprocessar e remover', () => {
    const r = bl.criarLote([{ nome: 'A', documento: '12345678909' }, { nome: 'B', documento: 'x' }, { nome: 'C', documento: '12345678909' }]);
    expect(r.criados).toHaveLength(1);
    expect(r.erros.map((x) => x.linha)).toEqual([2, 3]);
    expect(() => bl.criarLote(Array(501).fill({ nome: 'x', documento: '1' }))).toThrow(/Máximo de 500/);
    expect(bl.reprocessar()).toEqual({ ocorrencias: 0 });
    const lista = bl.listar();
    expect(lista.find((i) => i.nome === 'A')?.ocorrencias.total_linhas).toBe(0); // b1 não é a mais recente do fundo
    expect(lista[0].ocorrencias.novas_7d).toBe(0); // reprocessar zera o "novas na semana"
    bl.remover(r.criados[0].id);
    expect(bl.listar().some((i) => i.nome === 'A')).toBe(false);
    expect(() => bl.remover(r.criados[0].id)).toThrow(/não encontrada/);
  });
});
