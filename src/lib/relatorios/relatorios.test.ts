import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';

// Banco num diretório temporário; fundo, CNPJ e informe da CVM fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-relatorios-'));
let rel: typeof import('./relatorios');
let informe: typeof import('./informe');
let fmt: typeof import('./formatos');
let repo: typeof import('@/lib/repo');
let dbMod: typeof import('@/lib/db');

beforeAll(async () => {
  rel = await import('./relatorios');
  informe = await import('./informe');
  fmt = await import('./formatos');
  repo = await import('@/lib/repo');
  dbMod = await import('@/lib/db');
});

const CNPJ = '12345678000195';
const CNPJ_FMT = '12.345.678/0001-95';

/** ZIP no formato do portal da CVM, com as tabelas I, III e X_2 (latin1, `;`). */
async function zipCvm(comp: string) {
  const zip = new JSZip();
  const csv = (linhas: string[][]) => new TextEncoder().encode(linhas.map((l) => l.join(';')).join('\n'));
  zip.file(`inf_mensal_fidc_tab_I_${comp}.csv`, csv([
    ['CNPJ_FUNDO_CLASSE', 'TAB_I1_VL_DISP', 'TAB_I2A1_VL_CRED_VENC_AD', 'TAB_I2A2_VL_CRED_VENC_INAD', 'TAB_I2A21_VL_TOTAL_PARCELA_INAD', 'TAB_I2A3_VL_CRED_INAD', 'TAB_I2A11_VL_REDUCAO_RECUP'],
    [CNPJ_FMT, '100', '800', '50', '20', '30', '10'],
  ]));
  zip.file(`inf_mensal_fidc_tab_III_${comp}.csv`, csv([['CNPJ_FUNDO_CLASSE', 'TAB_III_A_VL_PAGAR'], [CNPJ_FMT, '0']]));
  zip.file(`inf_mensal_fidc_tab_X_2_${comp}.csv`, csv([
    ['CNPJ_FUNDO_CLASSE', 'TAB_X_CLASSE_SERIE', 'TAB_X_QT_COTA', 'TAB_X_VL_COTA'],
    [CNPJ_FMT, 'Senior', '970', '1'],
  ]));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('formatos', () => {
  test('moeda, percentual e contábil como no Bate Lastro', () => {
    expect(fmt.fmtMoeda(1234567.891)).toBe('1.234.567,89');
    expect(fmt.fmtMoeda(-10)).toBe('-10,00');
    expect(fmt.fmtPercentual(0.12345)).toBe('12,35%');
    expect(fmt.fmtContabil(0)).toBe('-');
    expect(fmt.fmtContabil(-1500)).toBe('(1.500,00)');
    expect(fmt.fmtContabil(1500, true)).toBe('1.500');
    expect(fmt.fmtContabil(null)).toBe('n/i');
  });
});

describe('informe mensal', () => {
  test('rateio: a parcela vencida sai do vincendo', () => {
    expect(informe.ratearVencerVencidos({ TAB_I2A1_VL_CRED_VENC_AD: '800', TAB_I2A2_VL_CRED_VENC_INAD: '50', TAB_I2A21_VL_TOTAL_PARCELA_INAD: '20', TAB_I2A3_VL_CRED_INAD: '30' }))
      .toMatchObject({ DC_COM_A_VENCER: 830, DC_COM_A_VENCIDOS: 50 });
  });

  test('trimestres: só meses encerrados, fechamento e antecipada', () => {
    const t = rel.trimestresDisponiveis(new Date(2026, 10, 19), 2);
    // Em 19/11 o 4º trimestre ainda não tem mês encerrado para oferecer (a antecipada é novembro).
    expect(t[0]).toMatchObject({ trimestre_curto: '3T2026' });
    expect(t[0].datas_base.map((d) => [d.data_base, d.antecipada])).toEqual([['2026-09-30', false], ['2026-08-31', true]]);
    expect(rel.trimestresDisponiveis(new Date(2026, 11, 1), 1)[0].datas_base.map((d) => d.data_base)).toEqual(['2026-11-30']);
  });
});

describe('emissão CVM/NIX', () => {
  test('prepara o rascunho, emite os dois e preenche os modelos', async () => {
    const c = await dbMod.db();
    const adm = await c.prepare("INSERT INTO administradoras (nome, razao_social, endereco, criado_em) VALUES ('ADM EXEMPLO', 'ADM EXEMPLO DTVM S.A.', 'Rua Fictícia, 100', ?)").run(new Date().toISOString());
    const f = await c.prepare("INSERT INTO fundos (nome, cnpj, tipo, administradora_id, criado_em, atualizado_em) VALUES ('FIDC EXEMPLO', ?, 'FIDC', ?, ?, ?)")
      .run(CNPJ, Number(adm.lastInsertRowid), new Date().toISOString(), new Date().toISOString());
    const fundoId = Number(f.lastInsertRowid);
    const baseId = await repo.criarBase({
      nome: 'FIDC EXEMPLO — 3º Trim/2026', nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: CNPJ, data_referencia: '2026-09-30', administradora: null,
      origem: 'amostra', arquivo_origem: 'amostra.xlsx', fundo_id: fundoId,
      titulos: ['1', '2'].map((n, i) => ({
        linha_origem: i + 2, id_base_origem: null, numero_documento: `10${n}`, sacado_nome: 'JOAO DA SILVA', sacado_documento: '12345678909',
        cedente_nome: 'EMPRESA FICTICIA LTDA', cedente_documento: '11222333000181', valor_total: '100.00', valor_aquisicao: '95.00',
        data_emissao: '2026-08-01', data_vencimento: i ? '2026-09-01' : '2026-12-01', data_aquisicao: '2026-08-02',
        nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: CNPJ, tipo_recebivel: 'DUPLICATA', chave_nfe: null, lados: {},
      })),
    });
    const zip = await zipCvm('202609');
    const baixar = async () => new Response(new Uint8Array(zip));

    const lista = await rel.fundosParaEmissao('2026-09-30');
    expect(lista[0]).toMatchObject({ nome: 'FIDC EXEMPLO', tem_carteira: false, tem_base: true, cenario: null });

    const r = await rel.prepararRascunho(fundoId, '2026-09-30', { baixar });
    expect(r.snapshot.base_id).toBe(baseId);
    expect(r.cenario).toBe('COM_DC');
    expect(r.snapshot.carteira.patrimonio_liquido).toBe(970);
    expect(r.snapshot.carteira.vincendos).toBe(830);
    expect(r.snapshot.carteira.conciliacao.status).toBe('OK'); // 100 + 830 + 50 − 10 = 970
    expect(r.snapshot.amostra.itens.map((i) => i.quantidade)).toEqual([0, 1, 1]); // recompra, vincendo, vencido
    expect(r.snapshot.verificacao.lastro).toMatchObject({ total: 2, verificados: 0, pendentes: 2 });
    expect(r.snapshot.roteiro_cvm).toBe('romano');
    expect(r.secoes.some((s) => s.chave === 'iv_a')).toBe(true);

    const salvo = await rel.salvarEscolhas(r.id, { iv_a: 'com_ocorrencia' }, { ii: 'Texto próprio da equipe.' });
    expect(salvo.textos.ii).toBe('Texto próprio da equipe.');
    expect(salvo.textos.iv_a).toMatch(/foram promovidos ajustes/);

    const emitidos = await rel.emitir(r.id, ['CVM', 'NIX']);
    expect(emitidos.map((e) => e.nome_arquivo)).toEqual(['CVM_FIDC EXEMPLO_12345678000195.docx', 'NIX_FIDC EXEMPLO_12345678000195.docx']);

    for (const e of emitidos) {
      const docx = await JSZip.loadAsync((await rel.arquivoDaEmissao(e.id)).conteudo);
      const xml = await docx.file('word/document.xml')!.async('string');
      const texto = xml.replace(/<[^>]+>/g, '');
      expect(texto).not.toContain('{{');
      expect(texto).toContain('FIDC EXEMPLO');
      expect(texto).toContain(CNPJ_FMT);
      if (e.tipo === 'CVM') {
        expect(texto).toContain('Texto próprio da equipe.');
        expect(texto).toContain('Direitos creditórios vincendos');
        expect(texto).toContain('Rua Fictícia, 100');
      } else {
        expect(texto).toContain('ADM EXEMPLO DTVM S.A.');
        expect(texto).toContain('JOAO DA SILVA'); // Anexo I
      }
      // O XML continua bem formado o bastante: parágrafos e linhas fecham.
      expect((xml.match(/<w:p[\s>]/g) ?? []).length).toBe((xml.match(/<\/w:p>/g) ?? []).length + (xml.match(/<w:p\s[^>]*\/>/g) ?? []).length);
      expect((xml.match(/<w:tr[\s>]/g) ?? []).length).toBe((xml.match(/<\/w:tr>/g) ?? []).length);
    }

    // Lote: um ZIP com os dois arquivos de cada fundo.
    const lote = await rel.emitirEmLote([fundoId], '2026-09-30', ['CVM'], { baixar });
    expect(lote.erros).toEqual([]);
    const pacote = await JSZip.loadAsync(await rel.zipDoLote(lote.lote_id));
    expect(Object.keys(pacote.files)).toEqual(['CVM_FIDC EXEMPLO_12345678000195.docx']);
  });

  test('sem carteira na CVM, a emissão é recusada com o que fazer', async () => {
    const c = await dbMod.db();
    const f = await c.prepare("INSERT INTO fundos (nome, cnpj, tipo, criado_em, atualizado_em) VALUES ('FIC EXEMPLO', '98765432000110', 'FIC_FIDC', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
    const zip = await zipCvm('202609');
    const r = await rel.prepararRascunho(Number(f.lastInsertRowid), '2026-09-30', { baixar: async () => new Response(new Uint8Array(zip)) });
    expect(r.cenario).toBe('SEM_DC');
    expect(r.snapshot.roteiro_cvm).toBe('numerado');
    await expect(rel.emitir(r.id, ['CVM'])).rejects.toThrow(/carteira do informe mensal/);
  });
});
