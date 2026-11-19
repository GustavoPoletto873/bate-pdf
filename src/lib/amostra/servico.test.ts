import { beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';

// Banco e pasta de dados temporários; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'lastro-amostra-'));
let servico: typeof import('./servico');
let dbMod: typeof import('@/lib/db');
let fundoId = 0;
let fundoPlanner = 0;

const latin1 = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const CAB = 'FUNDO;CEDENTE;IDENTIFICACAO_CEDENTE;SACADO;DOCUMENTO;SEU_NUMERO;VALOR_PRESENTE;VALOR_VENCIMENTO;DATA_VENCIMENTO;DATA_AQUISICAO;DATA_REFERENCIA';
function estoque(n: number, ref = '30/09/2026', extra = ''): Uint8Array {
  const linhas = [CAB];
  for (let i = 1; i <= n; i++) {
    const ced = String((i % 9) + 1).repeat(14);
    const aq = i % 2 ? '15/08/2026' : '10/01/2026';
    linhas.push(`FIDC TESTE;CEDENTE ${i % 9};${ced};SACADO ${i};${extra}${i};${i};${(i * 37) % 1000},${String(i % 100).padStart(2, '0')};100,00;20/09/2026;${aq};${ref}`);
  }
  return latin1(linhas.join('\n'));
}

beforeAll(async () => {
  dbMod = await import('@/lib/db');
  servico = await import('./servico');
  const c = dbMod.db();
  const ts = new Date().toISOString();
  c.prepare("INSERT INTO administradoras (nome, criado_em) VALUES ('PLANNER CORRETORA', ?)").run(ts);
  fundoId = Number(c.prepare("INSERT INTO fundos (nome, cnpj, criado_em, atualizado_em) VALUES ('FIDC TESTE', '12345678000195', ?, ?)").run(ts, ts).lastInsertRowid);
  fundoPlanner = Number(c.prepare("INSERT INTO fundos (nome, cnpj, administradora_id, criado_em, atualizado_em) VALUES ('FIDC PLANNER', '98765432000110', 1, ?, ?)").run(ts, ts).lastInsertRowid);
});

const pedido = (extra: Partial<Parameters<typeof servico.gerar>[0]> = {}) => ({
  fundoId, dataDe: '2026-07-01', dataAte: '2026-09-30', limiteAdquiridos: 30, limiteVencidos: 10, regra: 'padrao' as const,
  estoques: [{ nome: 'Estoque_12345678000195.csv', conteudo: estoque(200) }], ...extra,
});

describe('geração, histórico e arquivos', () => {
  it('gera, guarda e devolve o contrato do Upload Base', async () => {
    const a = await servico.gerar(pedido(), 'AAAA-BBBB-CCCC');
    expect(a).toMatchObject({ fundo_id: fundoId, data_de: '2026-07-01', data_ate: '2026-09-30', seed: 'AAAA-BBBB-CCCC', regra: 'padrao', status: 'GERADA', versao: 'amostragem-v1-local' });
    expect(a.populacao_titulos).toBe(200);
    expect(a.contagem['Maiores Cedentes']).toBe(15);
    expect(a.contagem['Adquiridos no Tri']).toBe(15);
    expect(a.total_titulos).toBe(15 + 15 + (a.contagem['Vencidos no Tri'] ?? 0));
    expect(a.insumos).toEqual([expect.objectContaining({ tipo: 'ESTOQUE', nome_arquivo: 'Estoque_12345678000195.csv' })]);

    const xlsx = await servico.arquivo(a.id, 'amostra');
    expect(xlsx.nome).toBe('Amostra_12345678000195_FIDC TESTE_20260930.xlsx');
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(xlsx.conteudo.buffer.slice(xlsx.conteudo.byteOffset, xlsx.conteudo.byteOffset + xlsx.conteudo.byteLength) as ArrayBuffer);
    expect(livro.worksheets.map((w) => w.name)).toEqual(['Amostra', 'Reproducao']);
    expect(livro.worksheets[0].rowCount).toBe(a.total_titulos + 1);
    expect(livro.worksheets[0].getRow(1).getCell(17).value).toBe('RELATORIO');

    const pacote = await servico.arquivo(a.id, 'pacote');
    const zip = await JSZip.loadAsync(pacote.conteudo);
    expect(Object.keys(zip.files).sort()).toEqual(['amostra.xlsx', 'estoques/', 'estoques/Estoque_12345678000195.csv'].filter((n) => zip.files[n]).sort());

    expect(await servico.verificar(a.id)).toEqual({ identica: true, divergencias: [] });
    expect(servico.listar(fundoId)[0].id).toBe(a.id);
    expect(servico.buscarPorSeed('aaaa-bbbb-cccc').id).toBe(a.id);
  });

  it('mesmo estoque em período sobreposto: 409 sem motivo; com motivo descarta a anterior', async () => {
    await expect(servico.gerar(pedido({ dataAte: '2026-09-29' }))).rejects.toMatchObject({ status: 409 });
    const nova = await servico.gerar(pedido({ dataAte: '2026-09-29', motivo: 'estoque incompleto' }));
    const historico = servico.listar(fundoId);
    expect(historico[0].id).toBe(nova.id);
    expect(historico[1]).toMatchObject({ status: 'DESCARTADA', motivo_descarte: 'Substituída por nova amostra: estoque incompleto' });
    expect(() => servico.descartar(nova.id, '  ')).toThrow(/motivo/);
    expect(servico.descartar(nova.id, 'teste').status).toBe('DESCARTADA');
    expect(() => servico.descartar(nova.id, 'de novo')).toThrow(/já foi descartada/);
  });

  it('amostra anterior do histórico tira os títulos dos Maiores Cedentes', async () => {
    const t1 = await servico.gerar(pedido({ dataDe: '2026-04-01', dataAte: '2026-06-30', estoques: [{ nome: 'Estoque_t2.csv', conteudo: estoque(200, '30/06/2026', 'X') }] }), 'BBBB-CCCC-DDDD');
    const t2 = await servico.gerar(pedido({ amostraAnteriorId: t1.id, estoques: [{ nome: 'Estoque_t3.csv', conteudo: estoque(200, '30/09/2026', 'X') }] }), 'CCCC-DDDD-EEEE');
    expect(t2.amostra_anterior_id).toBe(t1.id);
    expect(t2.contagem['Maiores Cedentes'] ?? 0).toBe(0);
    await expect(servico.gerar(pedido({ amostraAnteriorId: t2.id, estoques: [{ nome: 'Estoque_y.csv', conteudo: estoque(10) }] }))).rejects.toThrow(/terminar antes do início/);
  });

  it('erros do motor viram mensagem para a tela', async () => {
    await expect(servico.gerar(pedido({ dataAte: '2026-10-31', estoques: [{ nome: 'Estoque_z.csv', conteudo: estoque(5) }] }))).rejects.toThrow(/posterior à data-base/);
    await expect(servico.gerar(pedido({ fundoId: 999 }))).rejects.toMatchObject({ status: 404 });
  });

  it('conferir seed: registrada confere; desconhecida exige período', async () => {
    const estoques = [{ nome: 'qualquer-nome.csv', conteudo: estoque(200) }];
    const c = await servico.conferir('AAAA-BBBB-CCCC', estoques, {});
    expect(c.confere).toBe(true);
    expect(c.titulos.length).toBeGreaterThan(0);
    const outro = await servico.conferir('AAAA-BBBB-CCCC', [{ nome: 'x.csv', conteudo: estoque(199) }], {});
    expect(outro.confere).toBe(false);
    expect(outro.divergencias[0]).toMatch(/não são os da amostra registrada/);
    await expect(servico.conferir('ZZZZ-ZZZZ-ZZZZ', estoques, {})).rejects.toThrow(/informe o período/);
    const livre = await servico.conferir('ZZZZ-ZZZZ-ZZZZ', estoques, { dataDe: '2026-07-01', dataAte: '2026-09-30', limiteAdquiridos: 30, limiteVencidos: 10 });
    expect(livre.registrada).toBeNull();
    expect(livre.confere).toBeNull();
  });

  it('inspeciona data-base e fundo escrito no arquivo', async () => {
    const [i] = await servico.inspecionar([{ nome: 'Estoque.csv', conteudo: latin1('NOME_FUNDO;DOC_FUNDO;DATA_REFERENCIA;DOC_CEDENTE;VALOR_PRESENTE;NU_DOCUMENTO\nFIDC Ágata;12.345.678/0001-95;31/08/2026;1;1;1\n') }], true);
    expect(i).toEqual({ nome: 'Estoque.csv', data_base: '2026-08-31', fundo_nome: 'FIDC AGATA', fundo_cnpj: '12345678000195' });
  });
});

describe('regra Planner', () => {
  it('soma as pendências em aberto das bases anteriores do fundo', async () => {
    const c = dbMod.db();
    const ts = '2026-05-01T10:00:00.000Z';
    c.prepare("INSERT INTO bases (id, nome, origem, criado_em, atualizado_em, fundo_id, data_referencia) VALUES ('b-q2', 'Q2', 'amostra', ?, ?, ?, '2026-06-30')").run(ts, ts, fundoPlanner);
    const tit = (nu: string, ced: string) => Number(c.prepare(`INSERT INTO titulos (base_id, numero_documento, cedente_documento, cedente_nome, valor_total, data_vencimento)
      VALUES ('b-q2', ?, ?, 'CED', '100.00', '2026-06-10')`).run(nu, ced).lastInsertRowid);
    const t1 = tit('P1', '55555555000155');
    const t2 = tit('P2', '55555555000155');
    const pend = (t: number, lado: string, situacao: string) => c.prepare("INSERT INTO pendencias (base_id, titulo_id, lado, situacao) VALUES ('b-q2', ?, ?, ?)").run(t, lado, situacao);
    pend(t1, 'lastro', 'pendente');
    pend(t1, 'termo', 'vinculado');
    pend(t2, 'lastro', 'vinculado');
    pend(t2, 'termo', 'vinculado');
    const a = await servico.gerar({
      fundoId: fundoPlanner, dataDe: '2026-07-01', dataAte: '2026-09-30', limiteAdquiridos: 120, limiteVencidos: 120, regra: 'planner',
      estoques: [{ nome: 'Estoque_planner.csv', conteudo: estoque(300, '30/09/2026', 'PL') }],
    }, 'DDDD-EEEE-FFFF');
    expect(a.contagem['Pendências']).toBe(1);
    expect(a.contagem['Maiores Cedentes']).toBeUndefined();
    const sorteados = (a.contagem['Adquiridos no Tri'] ?? 0) + (a.contagem['Vencidos no Tri'] ?? 0);
    expect(sorteados).toBeLessThanOrEqual(120);
    expect(a.total_titulos).toBe(sorteados + 1);
    expect(a.avisos.some((x) => /Nenhuma base do 4T2025/.test(x))).toBe(true);
    const xlsx = await servico.arquivo(a.id, 'amostra');
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(xlsx.conteudo.buffer.slice(xlsx.conteudo.byteOffset, xlsx.conteudo.byteOffset + xlsx.conteudo.byteLength) as ArrayBuffer);
    expect(livro.worksheets.map((w) => w.name)).toEqual(['Consolidado', 'Amostra 3T2026', 'Pendências 2T2026', 'Reproducao']);
    expect(await servico.verificar(a.id)).toEqual({ identica: true, divergencias: [] });
  });
});
