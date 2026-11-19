import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';

// Banco num diretório temporário; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-fundos-'));
delete (globalThis as { __batePdfDb?: unknown }).__batePdfDb;

type Fundos = typeof import('@/lib/fundos');
let f: Fundos;
let repo: typeof import('@/lib/repo');

beforeAll(async () => {
  f = await import('@/lib/fundos');
  repo = await import('@/lib/repo');
});

/** CNPJ fictício com dígito verificador válido a partir de 12 dígitos. */
function comDv(base12: string): string {
  let d = base12;
  for (const pesos of [[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2], [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]]) {
    const resto = [...d].reduce((s, c, i) => s + Number(c) * pesos[i], 0) % 11;
    d += String(resto < 2 ? 0 : 11 - resto);
  }
  return d;
}

async function xlsx(abas: Record<string, unknown[][]>): Promise<Uint8Array> {
  const livro = new ExcelJS.Workbook();
  for (const [nome, linhas] of Object.entries(abas)) {
    const aba = livro.addWorksheet(nome);
    linhas.forEach((l, i) => { aba.getRow(i + 1).values = l as ExcelJS.CellValue[]; });
  }
  return new Uint8Array(await livro.xlsx.writeBuffer() as ArrayBuffer);
}

describe('regras do CNPJ (iguais ao Bate Lastro)', () => {
  test('dígito verificador', () => {
    expect(f.dvCnpjOk('11222333000181')).toBe(true);
    expect(f.dvCnpjOk('11222333000182')).toBe(false);
    expect(f.dvCnpjOk('11111111111111')).toBe(false);
    expect(f.dvCnpjOk('1122233300018')).toBe(false);
  });

  test('CNPJ da planilha: máscara, decimal, zeros comidos e notação científica', () => {
    expect(f.cnpjDaPlanilha('11.222.333/0001-81')).toEqual({ digitos: '11222333000181' });
    expect(f.cnpjDaPlanilha("'11222333000181")).toEqual({ digitos: '11222333000181' });
    expect(f.cnpjDaPlanilha('11222333000181.0')).toEqual({ digitos: '11222333000181' });
    const comZero = comDv('012345670001');
    expect(comZero.startsWith('0')).toBe(true);
    expect(f.cnpjDaPlanilha(comZero.slice(1))).toEqual({ digitos: comZero });
    // Sem o DV confirmar, os zeros não voltam.
    expect(f.cnpjDaPlanilha('1234567000100').motivo).toBe('CNPJ não tem 14 dígitos');
    expect(f.cnpjDaPlanilha('1,12223E+13').motivo).toMatch(/notação científica/);
    expect(f.cnpjDaPlanilha('1.12223330001810E+13')).toEqual({ digitos: '11222333000181' });
  });

  test('cabeçalhos aceitos e chave de nome', () => {
    expect(f.campoDaColuna('Nome do fundo')).toBe('name');
    expect(f.campoDaColuna('Tipo (FIDC ou FIC FIDC)')).toBe('fund_type');
    expect(f.campoDaColuna('CNPJ do Fundo')).toBe('cnpj');
    expect(f.campoDaColuna('Administradora')).toBe('administrador');
    expect(f.campoDaColuna('Gestora')).toBe('gestor');
    expect(f.chaveDeNome('  Administradora   São  Paulo ')).toBe('administradora sao paulo');
    expect(f.textoOuNulo('a​b ')).toBe('ab');
  });
});

describe('cadastro, lista e exclusão', () => {
  test('cria, recusa repetido e DV errado, edita, filtra, lote e exclui', () => {
    const adm = f.criarAdministradora('Administradora Fictícia');
    expect(() => f.criarAdministradora('administradora ficticia')).toThrow(/Já existe/);
    const a = f.criarFundo({ nome: 'FIDC Alfa', cnpj: '11.222.333/0001-81', administradora_id: adm.id, tipo: 'FIDC' });
    expect(a.cnpj).toBe('11222333000181');
    expect(a.administradora_nome).toBe('Administradora Fictícia');
    expect(() => f.criarFundo({ nome: 'Outro', cnpj: '11222333000181' })).toThrow(/já está cadastrado/);
    expect(() => f.criarFundo({ nome: 'Outro', cnpj: '11222333000182' })).toThrow(/dígito verificador/);
    const b = f.criarFundo({ nome: 'FIDC Beta Crédito', cnpj: comDv('223334440001'), tipo: 'FIC FIDC' });
    expect(b.tipo).toBe('FIC_FIDC');

    expect(f.listarFundos({ busca: 'credito' }).itens.map((x) => x.id)).toEqual([b.id]);
    expect(f.listarFundos({ busca: '11.222' }).itens.map((x) => x.id)).toEqual([a.id]);
    expect(f.listarFundos({ administradora: 0 }).itens.map((x) => x.id)).toEqual([b.id]);
    expect(f.listarFundos({ por_pagina: 1, pagina: 2 })).toMatchObject({ total: 2, itens: [{ id: b.id }] });

    expect(f.atualizarFundo(b.id, { gestor: 'Gestora Exemplo', administradora_id: adm.id }).gestor).toBe('Gestora Exemplo');
    expect(f.atualizarFundo(b.id, { administradora_id: null }).administradora_id).toBeNull();
    expect(f.atualizarEmLote([a.id, b.id], { gestor: 'Nova Gestora' })).toBe(2);
    expect(f.obterFundo(a.id)!.gestor).toBe('Nova Gestora');
    expect(f.obterFundo(a.id)!.administradora_id).toBe(adm.id);
    expect(() => f.atualizarEmLote([a.id, 9999], { gestor: 'x' })).toThrow(/não foi encontrado/);

    const baseId = repo.criarBase({
      nome: 'Base', nome_fundo: 'FIDC Alfa', cnpj_fundo: a.cnpj, data_referencia: '2026-09-30', administradora: null,
      origem: 'amostra', arquivo_origem: 'x.xlsx', titulos: [], fundo_id: a.id,
    });
    expect(f.usoDoFundo(a.id).bases).toBe(1);
    f.excluirFundo(a.id);
    expect(f.obterFundo(a.id)).toBeNull();
    expect(repo.obterBase(baseId)).toMatchObject({ fundo_id: null, nome_fundo: 'FIDC Alfa' });
  });
});

describe('importação em lote (create_all)', () => {
  test('prévia e gravação seguem as regras do Bate Lastro', async () => {
    const adm = f.criarAdministradora('Adm Importação');
    f.criarAdministradora('Gestão São Pedro');
    // Duas com o mesmo nome sem acento (só dá para acontecer com dados antigos: o cadastro recusa).
    (await import('@/lib/db')).db().prepare("INSERT INTO administradoras (nome, criado_em) VALUES ('Gestao Sao Pedro', 'x')").run();
    const existente = f.criarFundo({ nome: 'FIDC Existente', cnpj: comDv('334445550001') });
    const novo = comDv('445556660001');
    const repetido = comDv('556667770001');
    const arquivo = await xlsx({
      Administradores: [['Administrador'], ['Adm Importação']],
      Fundos: [
        ['CNPJ', 'Nome do fundo', 'Tipo', 'Administrador', 'Gestor'],
        [novo, 'FIDC Novo', 'FIC FIDC', 'ADM IMPORTACAO', 'Gestora X'],
        [existente.cnpj, 'nome ignorado', 'FIC_FIDC', 'adm importação', ''],
        [repetido, 'FIDC Rep', '', '', ''],
        [repetido, 'FIDC Rep 2', '', '', ''],
        ['11222333000182', 'DV errado', '', '', ''],
        [comDv('667778880001'), 'Adm desconhecida', '', 'Não Existe', ''],
        [comDv('778889990001'), 'Ambígua', '', 'gestao sao pedro', ''],
        [comDv('889990000001'), '', '', '', ''],
        [comDv('990001110001'), 'Tipo ruim', 'FII', '', ''],
        [],
        ['1,12223E+13', 'Científico', '', '', ''],
      ],
    });
    const previa = await f.importarFundos(arquivo, 'fundos.xlsx', true);
    expect(previa.simulacao).toBe(true);
    expect(previa.inseridos.map((i) => [i.linha, i.nome, i.tipo, i.administradora, i.gestor])).toEqual([
      [2, 'FIDC Novo', 'FIC_FIDC', 'Adm Importação', 'Gestora X'],
      [4, 'FIDC Rep', 'FIDC', 'Não informado', null],
    ]);
    expect(previa.atualizados).toEqual([{ linha: 3, nome: 'FIDC Existente', cnpj: expect.any(String), alteracoes: [{ campo: 'administradora', de: 'Não informado', para: 'Adm Importação' }] }]);
    const motivos = Object.fromEntries(previa.invalidos.map((i) => [i.linha, i.motivo]));
    expect(motivos[5]).toMatch(/repetido/);
    expect(motivos[6]).toMatch(/dígito verificador/);
    expect(motivos[7]).toMatch(/não está cadastrada. Cadastre-a primeiro/);
    expect(motivos[8]).toMatch(/mais de um cadastro/);
    expect(motivos[9]).toMatch(/preencha o nome/);
    expect(motivos[10]).toMatch(/Tipo de fundo inválido/);
    expect(motivos[12]).toMatch(/notação científica/);
    expect(f.fundoPorCnpj(novo)).toBeNull();

    const gravado = await f.importarFundos(arquivo, 'fundos.xlsx', false);
    expect(gravado.inseridos).toHaveLength(2);
    expect(f.fundoPorCnpj(novo)).toMatchObject({ nome: 'FIDC Novo', tipo: 'FIC_FIDC', administradora_id: adm.id, gestor: 'Gestora X' });
    expect(f.fundoPorCnpj(existente.cnpj)).toMatchObject({ nome: 'FIDC Existente', tipo: 'FIDC', administradora_id: adm.id });
    // De novo: nada a mudar.
    const deNovo = await f.importarFundos(arquivo, 'fundos.xlsx', true);
    expect(deNovo.inseridos).toHaveLength(0);
    expect(deNovo.duplicados.map((d) => d.linha)).toEqual([2, 3, 4]);
  });

  test('CSV com ponto e vírgula e formatos recusados', async () => {
    const csv = new TextEncoder().encode(`CNPJ;Nome do fundo\n${comDv('121212120001')};FIDC CSV\n`);
    const r = await f.importarFundos(csv, 'fundos.csv', true);
    expect(r.inseridos.map((i) => i.nome)).toEqual(['FIDC CSV']);
    await expect(f.importarFundos(csv, 'fundos.xls', true)).rejects.toThrow(/\.xls/);
    await expect(f.importarFundos(new TextEncoder().encode('Nome\nX\n'), 'f.csv', true)).rejects.toThrow(/coluna CNPJ/);
  });

  test('modelo traz as abas Fundos (CNPJ como texto) e Administradores', async () => {
    const bytes = await f.gerarModeloFundos();
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(bytes.buffer as ArrayBuffer);
    const fundos = livro.getWorksheet('Fundos')!;
    expect((fundos.getRow(1).values as unknown[]).slice(1)).toEqual(f.COLUNAS_MODELO_FUNDOS);
    expect(fundos.getCell('A2').numFmt).toBe('@');
    const nomes = (livro.getWorksheet('Administradores')!.getColumn(1).values as unknown[]).slice(2);
    expect(nomes).toContain('Adm Importação');
  });
});
