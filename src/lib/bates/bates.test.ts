import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from 'exceljs';
import type { TituloImportado } from '@/lib/planilha/importar';

// Banco num diretório temporário; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-bates-'));
let repo: typeof import('@/lib/repo');
let dbMod: typeof import('@/lib/db');
let processar: typeof import('./processar');
let pre: typeof import('./preMatches');
let res: typeof import('./resultados');
let ins: typeof import('./inserirResultado');
let exp: typeof import('@/lib/planilha/exportar');
let pend: typeof import('./exportarPendencias');

beforeAll(async () => {
  repo = await import('@/lib/repo');
  dbMod = await import('@/lib/db');
  processar = await import('./processar');
  pre = await import('./preMatches');
  res = await import('./resultados');
  ins = await import('./inserirResultado');
  exp = await import('@/lib/planilha/exportar');
  pend = await import('./exportarPendencias');
});

const CNPJ = '12345678000195';
const titulo = (n: string, valor: string, venc: string, idBase: number | null = null): TituloImportado => ({
  linha_origem: 2, id_base_origem: idBase, numero_documento: n, sacado_nome: 'JOAO DA SILVA', sacado_documento: '12345678909',
  cedente_nome: 'EMPRESA FICTICIA LTDA', cedente_documento: '11222333000181', valor_total: valor, valor_aquisicao: null,
  data_emissao: '2026-08-01', data_vencimento: venc, data_aquisicao: '2026-09-15',
  nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: CNPJ, tipo_recebivel: 'CCB', chave_nfe: null, lados: {},
});

function criarBase(titulos: TituloImportado[]) {
  return repo.criarBase({
    nome: 'Teste', nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: CNPJ, data_referencia: '2026-09-30', administradora: null,
    origem: 'amostra', arquivo_origem: 'amostra.xlsx', titulos,
  });
}

async function leitura(baseId: string, d: Record<string, string | number | null>) {
  const cols = Object.keys(d);
  const r = await (await dbMod.db()).prepare(`INSERT INTO leituras (base_id, origem, lida_em, ${cols.join(', ')}) VALUES (?, 'ia', ?, ${cols.map(() => '?').join(', ')})`)
    .run(baseId, new Date().toISOString(), ...Object.values(d));
  return Number(r.lastInsertRowid);
}

describe('painel da Gestão de Bates', () => {
  test('Leitura Termos/Lastros conta documentos, não linhas', async () => {
    const id = await criarBase([titulo('2001', '10.00', '2026-10-10')]);
    const pdf = await repo.registrarPdf(id, { nome_arquivo: 'ccb-parcelas.pdf', caminho_relativo: null, sha256: 'p1', tamanho: 1 });
    // Uma CCB com 3 parcelas = 3 linhas de leitura, 1 documento.
    for (const n of ['1', '2', '3']) await leitura(id, { pdf_id: pdf.id, tipo_recebivel: 'ccb', numero_documento: `2001-${n}` });
    await leitura(id, { tipo_recebivel: 'termo_cessao', numero_documento: '2001' });
    expect((await pre.painelDaBase(id)).leituras).toMatchObject({ termo: 1, lastro: 1, linhas_termo: 1, linhas_lastro: 3 });
  });
});

describe('Processar Base → pré-bates → confirmar/rejeitar', () => {
  test('fluxo completo da Gestão de Bates', async () => {
    const id = await criarBase([titulo('1001', '100.00', '2026-10-10'), titulo('1002', '200.00', '2026-11-10'), titulo('1003', '300.00', '2026-12-10')]);
    expect(await processar.podeProcessar(id)).toEqual({ pode_processar: true, motivo: 'sem_leituras' });
    const vazio = await processar.processarBase(id);
    expect(vazio.quantidade_pre_matches.total).toBe(0);
    expect(vazio.aviso).toMatch(/Não há documentos de leitura/);

    const pdf = await repo.registrarPdf(id, { nome_arquivo: 'ccb-1001.pdf', caminho_relativo: null, sha256: 'x1', tamanho: 1 });
    const l1 = await leitura(id, { pdf_id: pdf.id, tipo_recebivel: 'ccb', numero_documento: '1001', valor_nominal: '100.00', data_vencimento: '2026-10-10',
      sacado_documento: '12345678909', cedente_documento: '11222333000181', sacado_nome: 'JOAO DA SILVA', cedente_nome: 'EMPRESA FICTICIA LTDA', data_emissao: '2026-08-02' });
    const l2 = await leitura(id, { tipo_recebivel: 'termo_cessao', numero_documento: '1002', valor_nominal: '200.00', data_vencimento: '2026-11-10' });
    await leitura(id, { tipo_recebivel: 'ccb', numero_documento: '1002', valor_nominal: '200.00', data_vencimento: '2026-11-11' });
    const orfa = await leitura(id, { tipo_recebivel: 'ccb', numero_documento: '9999', valor_nominal: '1.00' });
    expect((await processar.podeProcessar(id)).motivo).toBe('leitura_nova');

    const r = await processar.processarBase(id);
    expect(r.aviso).toBeNull();
    expect(r.quantidade_pre_matches).toEqual({ total: 3, termo: 1, lastro: 2 });
    expect(r.quantidade_registro_base).toEqual({ total: 6, termo: 3, lastro: 3 });
    expect(r.quantidade_pendencias).toEqual({ total: 3, termo: 2, lastro: 1 });

    // A órfã continua livre: o botão segue liberado (como lá).
    expect((await processar.podeProcessar(id)).pode_processar).toBe(true);
    // Reprocessar não duplica.
    expect((await processar.processarBase(id)).quantidade_pre_matches.total).toBe(0);

    const painel = await pre.painelDaBase(id);
    expect(painel).toMatchObject({ total_pre_matches: 3, total_registros: 3, pendentes: { termo: 2, lastro: 1 }, leituras: { termo: 1, lastro: 3, orfas: 1 } });

    const lista = await pre.listarPreBates(id, { tipo: 'lastro' });
    expect(lista.total).toBe(2);
    expect(lista.por_tipo).toEqual({ todos: 3, termo: 1, lastro: 2 });
    const doL1 = lista.itens.find((i) => i.leitura.id === l1)!;
    expect(doL1).toMatchObject({ criterio: 1, similaridade: 1, tipo_validacao: 'LASTRO' });
    expect(doL1.confiabilidade.percentual).toBe(100);
    expect(doL1.campos!.find((c) => c.campo === 'data_emissao')!.veredito).toBe('D');
    expect((await pre.listarPreBates(id, { tipo: 'lastro', confiabilidade: [100] })).ids).toEqual([doL1.pre_match_id]);

    // Confirmar: vira vínculo automático com a leitura e o PDF dela.
    expect(await pre.confirmarPreBates(id, [doL1.pre_match_id])).toEqual({ confirmados: 1, descartados: 0 });
    const linha = (await repo.listarPendencias(id)).find((p) => p.vinculo?.leitura_id === l1)!;
    expect(linha).toMatchObject({ situacao: 'vinculado', lado: 'lastro' });
    expect(linha.vinculo).toMatchObject({ tipo_match: 'automatico', pdf_id: pdf.id, origem: 'pre_bate', similaridade: 1 });
    expect(linha.vinculo!.marcacoes).toMatchObject({ numero_documento: 'V', valor_total: 'V', data_emissao: 'D' });

    // Rejeitar: some o pré-bate, a pendência fica aberta e a leitura órfã.
    const termo = (await pre.listarPreBates(id, { tipo: 'termo' })).itens[0];
    expect(termo.leitura.id).toBe(l2);
    expect(await pre.rejeitarPreBates(id, [termo.pre_match_id])).toEqual({ rejeitados: 1 });
    const abertas = await pre.pendenciasEOrfas(id);
    expect(abertas.total_pendencias).toEqual({ termo: 3, lastro: 1 });
    expect(abertas.orfas.map((o) => o.id).sort()).toEqual([l2, orfa].sort());

    // Resultados: V = vínculo ou pré-bate; P = nenhum.
    const linhas = await res.linhasDeResultado(id);
    const est = res.estatisticas(linhas);
    expect(est.lastro).toMatchObject({ total: 3, total_v: 2, total_p: 1 });
    expect(est.termo).toMatchObject({ total: 3, total_v: 0 });
    expect(est.origem_v).toMatchObject({ automatico: 1, pre_bate: 1 });
    expect(res.filtrarResultados(linhas, { status: 'V', texto: '1002' }).total).toBe(1);

    await repo.excluirBase(id);
  });
});

describe('Bater PDF grava a leitura do vínculo', () => {
  test('vincular cria leitura bater_pdf e descarta o pré-bate; desfazer apaga a leitura', async () => {
    const id = await criarBase([titulo('2001', '150.00', '2026-10-10')]);
    await leitura(id, { tipo_recebivel: 'ccb', numero_documento: '2001', valor_nominal: '150.00', data_vencimento: '2026-10-10' });
    await processar.processarBase(id);
    const p = (await repo.listarPendencias(id)).find((x) => x.lado === 'lastro')!;
    expect(p.pre_bate).toMatchObject({ numero_documento: '2001', criterio: 5 });

    const pdf = await repo.registrarPdf(id, { nome_arquivo: 'doc.pdf', caminho_relativo: null, sha256: 'y', tamanho: 1 });
    const campos = ['numero_documento', 'sacado_nome', 'sacado_documento', 'cedente_nome', 'cedente_documento', 'valor_total', 'data_vencimento'] as const;
    await repo.salvarMarcacoes(id, [
      ...campos.map((campo) => ({ pendencia_id: p.pendencia_id, campo, valor: 'V' as const })),
      { pendencia_id: p.pendencia_id, campo: 'data_emissao', valor: 'D', valor_digitado: '2026-08-05' },
    ]);
    expect((await repo.vincular(id, [{ pendencia_id: p.pendencia_id, pdf_id: pdf.id, pagina: 2 }])).vinculados).toBe(1);
    const depois = (await repo.listarPendencias(id)).find((x) => x.pendencia_id === p.pendencia_id)!;
    expect(depois.pre_bate).toBeNull();
    const l = await (await dbMod.db()).prepare('SELECT * FROM leituras WHERE id = ?').get(depois.vinculo!.leitura_id!);
    expect(l).toMatchObject({ origem: 'bater_pdf', pdf_id: pdf.id, numero_documento: '2001', valor_nominal: '150.00', data_emissao: '2026-08-05', tipo_recebivel: 'CCB' });

    await repo.desvincular(id, [p.pendencia_id]);
    expect(await (await dbMod.db()).prepare('SELECT COUNT(*) n FROM leituras WHERE origem = ? AND base_id = ?').get('bater_pdf', id)).toEqual({ n: 0 });
    await repo.excluirBase(id);
  });
});

describe('exportação e Inserir Resultado', () => {
  async function abrir(bytes: Uint8Array) {
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load(bytes.buffer as ArrayBuffer);
    return livro;
  }

  test('exporta vínculo, pré-bate e pendente; a planilha volta pelo Inserir Resultado', async () => {
    const id = await criarBase([titulo('3001', '100.00', '2026-10-10', 501), titulo('3002', '200.00', '2026-11-10', 502), titulo('3003', '300.00', '2026-12-10', 503)]);
    await leitura(id, { tipo_recebivel: 'ccb', numero_documento: '3002', valor_nominal: '200.00', data_vencimento: '2026-11-10' });
    await processar.processarBase(id);

    const linhas = await res.linhasDaExportacao(id);
    expect(linhas).toHaveLength(6);
    const bytes = await exp.gerarPlanilhaResultados(linhas, { nome: 'Teste', cnpj: CNPJ, geradoEm: new Date(), nomeFundo: 'FIDC EXEMPLO', dataReferencia: '2026-09-30' });
    const livro = await abrir(bytes);
    expect(livro.worksheets.map((w) => w.name)).toEqual(['Resumo Executivo', 'TERMO', 'LASTRO']);
    const ws = livro.getWorksheet('LASTRO')!;
    const cab = (ws.getRow(3).values as string[]).slice(1);
    const linhaDe = (idBase: number) => {
      for (let n = 4; n <= ws.rowCount; n++) if (ws.getRow(n).getCell(1).value === idBase) return (c: string) => ws.getRow(n).getCell(cab.indexOf(c) + 1).value;
      throw new Error('linha não achada');
    };
    expect(linhaDe(502)('STATUS')).toBe('V'); // pré-bate sai como V (como lá)
    expect(linhaDe(502)('ORIGEM_BATE_PDF')).toBe('bate-pdf:pre_bate_a_confirmar');
    expect(linhaDe(501)('STATUS')).toBe('P');
    expect(livro.getWorksheet('Resumo Executivo')!.getCell('B7').value).toBe(1);

    // Edita a planilha como o revisor: título 3001 do Lastro batido à mão, 3002 (pré-bate) com um veredito D.
    for (let n = 4; n <= ws.rowCount; n++) {
      const row = ws.getRow(n);
      if (row.getCell(1).value === 501) {
        row.getCell(cab.indexOf('STATUS') + 1).value = 'V';
        row.getCell(cab.indexOf('LEITURA_NUMERO_DOC') + 1).value = '3001';
        row.getCell(cab.indexOf('LEITURA_VALOR_NOMINAL') + 1).value = 100;
        row.getCell(cab.indexOf('LEITURA_DATA_VENCIMENTO') + 1).value = '10/10/2026';
        for (const div of ['DIV_NUMERO_DOC', 'DIV_DOC_SACADO', 'DIV_NOME_CEDENTE', 'DIV_DOC_CEDENTE', 'DIV_VALOR_NOMINAL', 'DIV_DATA_VENCIMENTO']) {
          row.getCell(cab.indexOf(div) + 1).value = 'V';
        }
        row.getCell(cab.indexOf('DIV_NOME_SACADO') + 1).value = 'D';
      }
      if (row.getCell(1).value === 502) row.getCell(cab.indexOf('DIV_VALOR_NOMINAL') + 1).value = 'D';
    }
    const editada = new Uint8Array(await livro.xlsx.writeBuffer() as ArrayBuffer);
    const nome = exp.nomeDoArquivo(CNPJ);

    // Outro fundo é recusado.
    const outra = await criarBase([titulo('3001', '100.00', '2026-10-10')]);
    await (await dbMod.db()).prepare("UPDATE titulos SET cnpj_fundo = '99999999000199' WHERE base_id = ?").run(outra);
    await (await dbMod.db()).prepare("UPDATE bases SET cnpj_fundo = '99999999000199' WHERE id = ?").run(outra);
    await expect(ins.inserirResultado(outra, editada, nome, true)).rejects.toThrow(/outro fundo/);
    await repo.excluirBase(outra);

    const previa = await ins.inserirResultado(id, editada, nome, true);
    expect(previa.simulado).toBe(true);
    expect(previa.casos.lastro).toMatchObject({ bate_criado: 1, pre_bate_confirmado: 1 });
    expect(previa.total_a_gravar).toBe(2);
    // A prévia não grava nada.
    expect(res.estatisticas(await res.linhasDeResultado(id)).origem_v).toMatchObject({ manual: 0, pre_bate: 1 });

    const gravado = await ins.inserirResultado(id, editada, nome, false);
    expect(gravado.total_a_gravar).toBe(2);
    const depois = (await res.linhasDeResultado(id)).filter((l) => l.lado === 'lastro');
    const r501 = depois.find((l) => l.titulo.id_base_origem === 501)!;
    expect(r501).toMatchObject({ status: 'V', origem: 'vinculo', origem_vinculo: 'planilha', tipo_match: 'manual' });
    expect(r501.vereditos).toMatchObject({ sacado_nome: 'D', numero_documento: 'V', valor_total: 'V', data_emissao: 'P' });
    const r502 = depois.find((l) => l.titulo.id_base_origem === 502)!;
    expect(r502).toMatchObject({ origem: 'vinculo', tipo_match: 'automatico' });
    expect(r502.vereditos!.valor_total).toBe('D');

    // De novo: nada a gravar (a planilha nunca desfaz e já está igual).
    const denovo = await ins.inserirResultado(id, editada, nome, true);
    expect(denovo.total_a_gravar).toBe(0);
    expect(denovo.casos.lastro.ja_batido_igual).toBe(2);

    // Pendências: 3003 sem Lastro e os 3 sem Termo.
    const p = await res.pendenciasParaExportar(id);
    expect(p.faltantes.map((f) => `${f.lado}:${f.titulo.numero_documento}`)).toEqual(['lastro:3003', 'termo:3001', 'termo:3002', 'termo:3003']);
    expect(p.consolidadas).toHaveLength(3);
    const l1 = await abrir(await pend.planilhaPendencias({ nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: CNPJ, data_referencia: '2026-09-30' }, p.faltantes));
    const ws1 = l1.getWorksheet('Planilha1')!;
    expect(ws1.getCell('D5').value).toBe(4);
    expect(ws1.getCell('D7').value).toBe('Lastro - 1 itens:');
    expect(ws1.getCell('D9').value).toBe('3003');
    const l2 = await abrir(await pend.planilhaPendenciasConsolidada(p.consolidadas));
    expect(l2.getWorksheet('LASTRO E TERMO')!.getCell('B4').value).toBe('P');
    expect(pend.nomeDoArquivoPendencias({ nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: CNPJ, data_referencia: '2026-09-30' }, new Date('2026-11-18T13:00:00Z')))
      .toBe('Pendencias_FIDC EXEMPLO_12345678000195_3T2026_2026-11-18_10-00-00.xlsx');
    await repo.excluirBase(id);
  });

  test('conversões do importador', () => {
    expect(ins.valorDecimal('1.234')).toBe('1234.00');
    expect(ins.valorDecimal('R$ 1.234,56')).toBe('1234.56');
    expect(ins.valorDecimal(0)).toBeNull();
    expect(ins.valorDecimal('2.345')).toBe('2345.00');
    expect(ins.valorDecimal('2,345')).toBe('2.34'); // arredondamento bancário (Decimal.quantize)
    expect(ins.dataIso('03/04/2026')).toBe('2026-04-03');
    expect(ins.dataIso('2026-04-03 00:00:00')).toBe('2026-04-03');
    expect(ins.numeroNormalizado(' 00a12 ')).toBe('A12');
  });
});
