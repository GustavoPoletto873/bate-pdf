/* eslint-disable @typescript-eslint/no-explicit-any */
/** Porta de backend/tests/test_regras_fundo.py e test_perfis_recebivel.py (dados fictícios). */
import { describe, expect, test } from 'vitest';
import { chavesDocumento, naoEncontradoViraD, numeroConfere, preClassificarNucleo } from './motor';
import { PERFIS, assinaturaDaAmostra, familiaRecebivel, perfilDe, regrasDoFundo, regrasDoFundoDaAmostra } from './perfis';
import { DUPLICATA, pagina, registro } from './testes-util';

const pre = (regs: any[], paginas: any[], opcoes: any = {}) => preClassificarNucleo(regs, paginas, opcoes);
const tipos = (paginas: { pdf: string }[], termo: (pdf: string) => boolean) => Object.fromEntries(paginas.map((p) => [p.pdf, termo(p.pdf)]));

describe('administradora', () => {
  const QI = { nao_enviados: ['data_emissao'], valor_pela_amostra: true, administradora: 'QI TECH', origem: 'cadastro' };
  const NADA = { nao_enviados: [], valor_pela_amostra: false, administradora: null, origem: null };
  const ASSINATURA_QI = { linhas: 500, com_emissao: 0, com_valor_aquisicao: 0 };

  test('QI TECH em qualquer grafia não manda emissão', () => {
    for (const nome of ['QI TECH', 'QI Tech', 'qitech', 'QI TECH DTVM S.A.']) expect(regrasDoFundo([nome]), nome).toEqual(QI);
  });

  test('outras administradoras e fundo sem cadastro conferem tudo', () => {
    expect(regrasDoFundo(['PLANNER', 'Não informado', null])).toEqual(NADA);
    expect(regrasDoFundo([])).toEqual(NADA);
  });

  test('sem administradora no cadastro a assinatura da amostra identifica a QI TECH', () => {
    for (const cadastro of [[], ['Não informado'], [null]]) {
      expect(regrasDoFundo(cadastro, ASSINATURA_QI)).toEqual({ ...QI, origem: 'assinatura' });
    }
    expect(regrasDoFundo(['PLANNER'], ASSINATURA_QI)).toEqual(NADA);
    for (const a of [{ ...ASSINATURA_QI, com_emissao: 3 }, { ...ASSINATURA_QI, com_valor_aquisicao: 1 }, { ...ASSINATURA_QI, linhas: 5 }]) {
      expect(regrasDoFundo([], a)).toEqual(NADA);
    }
  });

  test('assinatura calculada das linhas da amostra', () => {
    const linhas = Array.from({ length: 25 }, () => ({ DATA_EMISSAO: '', VALOR_AQUISICAO: '0' }));
    expect(assinaturaDaAmostra(linhas)).toEqual({ linhas: 25, com_emissao: 0, com_valor_aquisicao: 0 });
    expect(regrasDoFundoDaAmostra(linhas).origem).toBe('assinatura');
    expect(regrasDoFundoDaAmostra([...linhas, { DATA_EMISSAO: '2026-01-01', VALOR_AQUISICAO: '1' }]).origem).toBeNull();
  });
});

describe('regras do fundo na pré-classificação', () => {
  const emissao = (opcoes: any = {}) => pre([registro(1, 'duplicata', {
    numero_documento: "'52635-01", valor_total: '1613.33', data_vencimento: '2026-09-05', data_emissao: null, data_aquisicao: '2026-09-01',
    sacado_documento: '33.444.555/0002-07', sacado_nome: 'EXEMPLO ACADEMIA DE GINASTICA LTDA',
    cedente_documento: '11.222.333/0001-81', cedente_nome: 'PAPELARIA MODELO LTDA',
  })], [pagina('dup.pdf', 1, DUPLICATA)], opcoes).resultados[0].campos.data_emissao;

  test('emissão vazia da QI TECH não vira a aquisição', () => {
    expect(emissao().regra).toBe('amostra_outra_coluna');
    const qi = emissao({ regrasFundo: { nao_enviados: ['data_emissao'], administradora: 'QI TECH' } });
    expect([qi.valor, qi.encontrado, qi.regra]).toEqual(['V', null, 'nao_enviado_pela_administradora']);
    expect(qi.fonte.motivo).toContain('QI TECH');
  });

  test('emissão da QI TECH vem validada e não segura o título', () => {
    const r = pre([registro(1, 'duplicata', {
      numero_documento: "'52635-01", valor_total: '1613.33', data_vencimento: '2026-09-05', data_emissao: null, data_aquisicao: '2026-09-01',
      sacado_documento: '33.444.555/0002-07', cedente_documento: '11.222.333/0001-81',
    })], [pagina('dup.pdf', 1, DUPLICATA)], { regrasFundo: { nao_enviados: ['data_emissao'] } });
    const e = naoEncontradoViraD(r).resultados[0].campos.data_emissao;
    expect([e.valor, e.regra]).toEqual(['V', 'nao_enviado_pela_administradora']);
  });

  test('QI TECH mantém o valor da amostra que não está no documento', () => {
    const valor = (opcoes: any = {}) => pre([registro(1, 'duplicata', {
      numero_documento: "'52635-01", valor_total: '1500.00', data_vencimento: '2026-09-05', sacado_documento: '33.444.555/0002-07',
      sacado_nome: 'EXEMPLO ACADEMIA DE GINASTICA LTDA',
    })], [pagina('dup.pdf', 1, DUPLICATA)], opcoes).resultados[0].campos.valor_total;
    expect(valor().valor).toBe('P');
    const qi = valor({ regrasFundo: { valor_pela_amostra: true } });
    expect([qi.valor, qi.regra, qi.fonte.coluna]).toEqual(['V', 'valor_pela_amostra', 'VALOR_NOMINAL']);
  });

  test('sem termo os campos do termo ficam V pela amostra', () => {
    const campos = pre([registro(1, 'termo_cessao', {
      numero_documento: "'52635-01", valor_total: '1613.33', data_vencimento: '2026-09-05', data_aquisicao: '2026-08-01',
      nome_fundo: 'FUNDO ALFA FIDC', cnpj_fundo: '11.444.777/0001-61', sacado_documento: '33.444.555/0002-07',
    })], [pagina('dup.pdf', 1, DUPLICATA)]).resultados[0].campos;
    for (const c of ['data_aquisicao', 'nome_cessionario', 'doc_cessionario']) expect([campos[c].valor, campos[c].regra], c).toEqual(['V', 'termo_pela_amostra']);
  });

  const CCB_T = 'CEDULA DE CREDITO BANCARIO Nº 4321987\r\nEMITENTE: JOANA MARIA PEREIRA CPF 123.456.789-09\r\n'
    + 'VALOR DA PARCELA R$ 345,67 VENCIMENTO 10/10/2026\r\n';
  const CLAUSULA = '12. CESSAO/ENDOSSO. O EMITENTE DECLARA CIENCIA DO ENDOSSO DA PRESENTE CEDULA DE CREDITO BANCARIO\r\n'
    + 'AO FUNDO ALFA FUNDO DE INVESTIMENTO EM DIREITOS CREDITORIOS, CNPJ 11.444.777/0001-61\r\n';
  const ccbComoTermo = (clausula: string) => pre([registro(1, 'termo_cessao', {
    numero_documento: "'4321987", sacado_nome: 'JOANA MARIA PEREIRA', sacado_documento: '123.456.789-09', valor_total: '345.67',
    data_vencimento: '2026-10-10', data_aquisicao: '2026-07-15', nome_fundo: 'FUNDO ALFA FIDC', cnpj_fundo: '11.444.777/0001-61',
  })], [pagina('ccb.pdf', 1, CCB_T), pagina('ccb.pdf', 2, clausula)], { tiposPdf: { 'ccb.pdf': false } }).resultados[0];

  test('sem termo a CCB com endosso ao fundo serve de termo', () => {
    const res = ccbComoTermo(CLAUSULA);
    const termo = res.candidatos.termo;
    expect([termo.processed_pdf, termo.pagina, termo.regra]).toEqual(['ccb.pdf', 2, 'ccb_como_termo']);
    expect(res.campos.doc_cessionario.valor).toBe('V');
    expect(res.campos.data_aquisicao.valor).toBe('V');
  });

  test('cláusula genérica sem o fundo não vale', () => {
    expect(ccbComoTermo('12. CESSAO/ENDOSSO. O CREDOR PODERA CEDER OU ENDOSSAR A PRESENTE CEDULA A TERCEIROS.\r\n').candidatos)
      .not.toHaveProperty('termo');
  });

  test('P vira D sem valor e o resto não muda', () => {
    const r = { resultados: [{ campos: {
      valor_total: { valor: 'P', encontrado: null, busca: { documentos: 3 } },
      numero_documento: { valor: 'V', encontrado: '123' },
    } }] };
    const campos = naoEncontradoViraD(r).resultados[0].campos;
    expect(campos.valor_total).toEqual({ valor: 'D', encontrado: '', regra: 'nao_encontrado', busca: { documentos: 3 } });
    expect(campos.numero_documento).toEqual({ valor: 'V', encontrado: '123' });
  });

  test('emissão que não existe em lugar nenhum é caso resolvido', () => {
    const r = (e: string | null) => ({ resultados: [{ registros: [{ base_data_emissao: e }], campos: { data_emissao: { valor: 'P', encontrado: null } } }] });
    expect(naoEncontradoViraD(r(null)).resultados[0].campos.data_emissao.regra).toBe('emissao_sem_valor');
    expect(naoEncontradoViraD(r('2026-08-05')).resultados[0].campos.data_emissao.regra).toBe('nao_encontrado');
  });
});

describe('perfis por tipo de recebível', () => {
  test('grafias da amostra', () => {
    const casos: [string | null, string][] = [
      ['NOTA COMERCIAL', 'NOTA COMERCIAL'], ['Nota Comercial Pré Fixada QI', 'NOTA COMERCIAL'],
      ['NC_ALFA 3E   VCTO: 08122028 > 100% CDI', 'NOTA COMERCIAL'], ['DM - DUPLICATA MERCANTIL', 'DUPLICATA'],
      ['DUPLICATA DE SERVICO FISICO', 'DUPLICATA'], ['CCB PRE DIGITAL', 'CCB PRE DIGITAL'], ['CCB/ ECONSIG', 'CCB OUTRAS'],
      ['Confissão de Dívida', 'CONFISSAO DE DIVIDA'], ['CONTRATO FISICO', 'CONTRATO'], ['NOTA DE DÉBITO', 'NOTA DE DEBITO'],
      ['CPR', 'CPR'], ['CPRf', 'CPR'], ['PRECATORIO', 'OUTROS'], [null, 'OUTROS'],
    ];
    for (const [tipo, familia] of casos) expect(familiaRecebivel(tipo), String(tipo)).toBe(familia);
  });

  test('todo perfil existe', () => {
    for (const tipo of ['NC 1', 'CCB DIGITAL', 'CPR', '']) expect(Object.values(PERFIS)).toContain(perfilDe(tipo));
  });

  test('nº do documento sem o sufixo da parcela', () => {
    const chaves = chavesDocumento('445566701')!;
    expect(numeroConfere(chaves, ['445566701'], '445566701')).toBe('exato');
    expect(numeroConfere(chaves, ['4455667'], '4455667', true)).toBe('parcela');
    expect(numeroConfere(chaves, ['4455667'], '4455667')).toBeNull();
    expect(numeroConfere(chaves, ['4455'], '4455', true)).toBeNull();
    expect(numeroConfere(chavesDocumento('44556670001')!, ['44556'], '44556', true)).toBeNull();
  });

  test('nº da CCB no meio do nº da amostra', () => {
    const chaves = chavesDocumento("'001230000123456007")!;
    expect(numeroConfere(chaves, ['123456'], '123456', true, '0000123456')).toBe('parcela');
    expect(numeroConfere(chaves, ['123456'], '123456', true)).toBeNull();
    expect(numeroConfere(chavesDocumento("'001200000000000007")!, ['0'], '0', true, '00000000')).toBeNull();
  });

  const TERMO_CCB_PRE_DIGITAL = 'TERMO DE CESSÃO DE CRÉDITOS\r\n'
    + 'Pelo presente, a CEDENTE CREDORA BETA SA cede ao FUNDO ALFA FIDC, CNPJ 11.444.777/0001-61,\r\n'
    + 'nos termos da cláusula 2.1 do contrato de cessão, em 12/05/2026 ("data de aquisição"),\r\n'
    + 'a Cédula de Crédito Bancário nº 4455667 emitida por MARIA APARECIDA SOUZA.\r\n';
  const ccbPreDigital = () => pre([registro(1, 'termo_cessao', {
    numero_documento: '445566701', sacado_nome: 'MARIA APARECIDA SOUZA', sacado_documento: '123.456.789-09', valor_total: '812.40',
    data_emissao: '2026-05-10', data_vencimento: '2026-07-10', data_aquisicao: '2026-05-12', nome_fundo: 'FUNDO ALFA FIDC',
    cnpj_fundo: '11.444.777/0001-61', tipo_recebivel: 'CCB PRE DIGITAL',
  })], [pagina('termo.pdf', 1, TERMO_CCB_PRE_DIGITAL)], { tiposPdf: { 'termo.pdf': true } }).resultados[0];

  test('nº da CCB mais nome identificam o título', () => {
    const res = ccbPreDigital();
    expect([res.campos.numero_documento.valor, res.campos.numero_documento.regra]).toEqual(['V', 'numero_com_parcela']);
    expect(res.campos.sacado_nome.valor).toBe('V');
    expect(res.confianca).toBe('alta');
  });

  test('o que o termo não traz segue o time', () => {
    const campos = ccbPreDigital().campos;
    expect(campos.valor_total.valor).toBe('P');
    expect(campos.sacado_documento.valor).toBe('P');
  });

  const TERMO_DUPLICATAS = 'TERMO DE CESSÃO\r\n'
    + 'CESSIONÁRIA: FUNDO ALFA FIDC CNPJ 11.444.777/0001-61 Data de aquisição: 05/08/2026\r\n'
    + 'RELAÇÃO DE TÍTULOS\r\n52623-05 R$ 2.000,00 10/09/2026\r\n52623-06 R$ 2.500,00 10/10/2026\r\n77777-01 R$ 999,90 11/11/2026\r\n';
  const convencoes = (tipo: string) => pre([registro(1, 'termo_cessao', {
    numero_documento: '52623-05', sacado_documento: '12.345.678/0001-95', valor_total: '2000.00', data_vencimento: '2026-09-10',
    data_aquisicao: '2026-08-05', cnpj_fundo: '11.444.777/0001-61', tipo_recebivel: tipo,
  })], [pagina('termo.pdf', 1, TERMO_DUPLICATAS)], { tiposPdf: { 'termo.pdf': true } }).resultados[0];

  test('termo de duplicata sem CPF do sacado é V pelo padrão do time', () => {
    const s = convencoes('DUPLICATA').campos.sacado_documento;
    expect([s.valor, s.regra]).toEqual(['V', 'nao_consta_no_documento']);
  });
  test('tipo sem padrão aprendido continua P', () => {
    expect(convencoes('CPR').campos.sacado_documento.valor).toBe('P');
  });
  test('campo vazio na amostra não vira V', () => {
    expect(convencoes('DUPLICATA').campos.sacado_nome.valor).toBe('P');
  });

  const paginasNotaComercial = () => {
    const paginas = [pagina('nc.pdf', 1, 'TERMO DE EMISSÃO DE NOTAS COMERCIAIS ESCRITURAIS\r\n'
      + 'EMISSORA: EMPRESA GAMA LTDA, inscrita no CNPJ/ME sob o nº 22.333.444/0001-05\r\n')];
    for (const n of [2, 3]) paginas.push(pagina('nc.pdf', n, 'Cláusulas gerais da emissão, sem valores.\r\n'));
    paginas.push(pagina('nc.pdf', 4, 'Para todos os fins e efeitos legais, a data de emiss„o das notas \r\n'
      + 'comerciais ser· 07 de julho de 2026.\r\n'));
    for (let n = 5; n < 20; n++) paginas.push(pagina('nc.pdf', n, 'Obrigações da emissora.\r\n'));
    paginas.push(pagina('nc.pdf', 20, 'ANEXO I – CRONOGRAMA DE PAGAMENTO\r\n'
      + 'Parcela Vencimento Saldo Devedor Amortização Juros Pagamento\r\n'
      + '1 07/01/2027 R$ 1.000.000,00 R$ 0,00 R$ 45.000,00 R$ 45.000,00\r\n'
      + '2 07/07/2027 R$ 0,00 R$ 1.000.000,00 R$ 41.000,00 R$ 1.041.000,00\r\n'));
    return paginas;
  };
  const notaComercial = (emissao: string) => pre([registro(1, 'lastro', {
    numero_documento: '1234-2', sacado_nome: 'EMPRESA GAMA LTDA', sacado_documento: '22.333.444/0001-05', valor_total: '1041000.00',
    data_emissao: emissao, data_vencimento: '2027-07-07', tipo_recebivel: 'NOTA COMERCIAL',
  })], paginasNotaComercial(), { tiposPdf: { 'nc.pdf': false } }).resultados[0];

  test('valor vem do cronograma no anexo do fim', () => {
    const res = notaComercial('2026-07-07');
    expect(res.campos.valor_total.valor).toBe('V');
    expect(res.campos.sacado_documento.valor).toBe('V');
    expect(['alta', 'media']).toContain(res.confianca);
  });
  test('emissão um dia depois da cláusula mantém a amostra', () => {
    const e = notaComercial('2026-07-08').campos.data_emissao;
    expect([e.valor, e.regra, e.data_documento]).toEqual(['V', 'planilha_um_dia_depois', '2026-07-07']);
  });
  test('nº que o documento não traz é V pelo padrão do time', () => {
    const n = notaComercial('2026-07-07').campos.numero_documento;
    expect([n.valor, n.regra]).toEqual(['V', 'nao_consta_no_documento']);
  });

  test('páginas do mesmo documento não concorrem', () => {
    const CCB_DUAS = 'CÉDULA DE CRÉDITO BANCÁRIO Nº 99887766\r\nEMITENTE: JOSÉ CARLOS PEREIRA CPF 123.456.789-09\r\n'
      + 'VALOR DA PARCELA: R$ 1.234,56 VENCIMENTO: 10/09/2026\r\n';
    const res = pre([registro(1, 'lastro', {
      numero_documento: '99887766', sacado_documento: '123.456.789-09', valor_total: '1234.56', data_vencimento: '2026-09-10',
      tipo_recebivel: 'CCB DIGITAL',
    })], [pagina('ccb.pdf', 1, CCB_DUAS), pagina('ccb.pdf', 2, CCB_DUAS)], { tiposPdf: { 'ccb.pdf': false } }).resultados[0];
    expect(res.confianca).toBe('alta');
  });

  const CONTRATO_IMOVEL = 'CONTRATO DE PROMESSA DE COMPRA E VENDA DE UNIDADE\r\n'
    + 'VENDEDORA: CONSTRUTORA DELTA EMPREENDIMENTOS LTDA, CNPJ 44.555.666/0001-77\r\n'
    + 'COMPRADOR: neste ato representado por seu sócio, CPF 98765432100\r\n';

  test('nome do sacado acha o contrato sem outra âncora', () => {
    const reg = registro(1, 'lastro', {
      numero_documento: '77', sacado_nome: 'CONSTRUTORA DELTA EMPREENDIMENTOS LTDA', sacado_documento: '44.555.666/0001-77',
      valor_total: '350000.00', tipo_recebivel: 'CONTRATO FISICO',
    });
    reg.base_sacado_documento = '11.111.111/0001-11';
    const res = pre([reg], [pagina('contrato.pdf', 1, CONTRATO_IMOVEL)], { tiposPdf: { 'contrato.pdf': false } }).resultados[0];
    expect(res.candidatos.lastro.processed_pdf).toBe('contrato.pdf');
    expect(res.campos.sacado_nome.valor).toBe('V');
    expect(['alta', 'media']).not.toContain(res.confianca);
  });

  test('outro tipo não ancora por nome', () => {
    const res = pre([registro(1, 'lastro', {
      sacado_nome: 'CONSTRUTORA DELTA EMPREENDIMENTOS LTDA', sacado_documento: '11.111.111/0001-11', tipo_recebivel: 'DUPLICATA',
    })], [pagina('contrato.pdf', 1, CONTRATO_IMOVEL)], { tiposPdf: { 'contrato.pdf': false } }).resultados[0];
    expect(res.confianca).toBe('sem_candidato');
  });

  test('padrão da única base do histórico (Nota de Débito)', () => {
    const perfil = perfilDe('NOTA DE DÉBITO');
    expect(perfil.convencao('termo', 'sacado_nome')).toBe('D');
    expect(perfil.convencao('termo', 'data_emissao')).toBe('V');
    expect(perfil.convencao('termo', 'doc_cessionario')).toBeNull();
  });

  const dataDoTermo = (aq: string) => {
    const termo = TERMO_DUPLICATAS.replace(' Data de aquisição: 05/08/2026', '') + 'São Paulo, sexta-feira, 7 de agosto de 2026.\r\n';
    return pre([registro(1, 'termo_cessao', {
      numero_documento: '52623-05', valor_total: '2000.00', data_vencimento: '2026-09-10', data_aquisicao: aq, tipo_recebivel: 'DUPLICATA',
    })], [pagina('termo.pdf', 1, termo)], { tiposPdf: { 'termo.pdf': true } }).resultados[0].campos.data_aquisicao;
  };
  test('data por extenso do termo confirma a aquisição', () => {
    const s = dataDoTermo('2026-08-07');
    expect([s.valor, s.confirmado_por.rotulo]).toEqual(['V', 'Data do termo']);
  });
  test('segunda na amostra e sexta no termo fica a amostra', () => {
    const s = dataDoTermo('2026-08-10');
    expect(s.valor).toBe('V');
    expect(s.regra).not.toBe('planilha_um_dia_depois');
  });
});

const CCB_CONSIGNADO = 'CÉDULA DE CRÉDITO BANCÁRIO Nº 0012345678901\r\n'
  + 'CRÉDITO CONSIGNADO\r\nCREDORA\r\n'
  + 'BETA SOLUÇÕES DIGITAIS SOCIEDADE DE CRÉDITO DIRETO S/A, inscrita no CNPJ/MF sob o nº 22.333.444/0001-05.\r\n'
  + 'QUADRO I - QUALIFICAÇÃO DO EMITENTE\r\nNOME: JOANA MARIA PEREIRA\r\nCPF: 123.456.789-09\r\n'
  + 'QUADRO II - CARACTERÍSTICAS DA OPERAÇÃO\r\n'
  + '1. Valor liberado\r\ncliente:\r\n3.210,00 98,00 %* 7. Valor das\r\nparcelas:\r\n345,67\r\n'
  + '8. Quantidade de\r\nparcelas:\r\n12\r\n'
  + '9. Vencimento da\r\n1ª parcela:\r\n10/08/2026\r\n'
  + '10. Vencimento da\r\núltima parcela:\r\n10/07/2027\r\n';
const BILHETE_SEGURO = 'DADOS DO SEGURADO (VOCÊ)\r\nNOME: JOANA MARIA PEREIRA CPF: 123.456.789-09\r\n'
  + 'BILHETE NÚMERO 9988776655443 DATA DE EMISSÃO:15/07/2026\r\n'
  + 'OBRIGAÇÃO (DÍVIDA) A QUAL O SEGURO ESTÁ VINCULADO: 345,67\r\n';

describe('CCB de consignado', () => {
  const rodar = (valor = '345.67', vencimento = '2026-10-10', paginas: any[] | null = null) => {
    const pgs = paginas ?? [pagina('ccb.pdf', 1, CCB_CONSIGNADO)];
    return pre([registro(1, 'lastro', {
      numero_documento: "'990012345678901003", sacado_nome: 'JOANA MARIA PEREIRA', sacado_documento: '123.456.789-09',
      cedente_nome: 'BETA SCD', cedente_documento: '22.333.444/0001-05', valor_total: valor, data_vencimento: vencimento,
      tipo_recebivel: 'CCB PRE DIGITAL',
    })], pgs, { tiposPdf: tipos(pgs, () => false) }).resultados[0];
  };

  test('cronograma com rótulo quebrado confirma a parcela', () => {
    const venc = rodar().campos.data_vencimento;
    expect(venc.valor).toBe('V');
    expect(venc).not.toHaveProperty('alerta');
    expect(venc.regra).toBe('cronograma_parcelas');
  });
  test('sigla SCD confere com o nome por extenso', () => {
    expect(rodar().campos.cedente_nome.valor).toBe('V');
  });
  test('número e valor da parcela', () => {
    const c = rodar().campos;
    expect([c.numero_documento.valor, c.numero_documento.regra]).toEqual(['V', 'numero_com_parcela']);
    expect(c.valor_total.valor).toBe('V');
  });
  test('valor que não está em documento nenhum é pendência', () => {
    const v = rodar('290.00').campos.valor_total;
    expect([v.valor, v.encontrado]).toEqual(['P', null]);
  });
  test('valor achado em outra página do documento confere', () => {
    const v = rodar('290.00', '2026-10-10', [pagina('ccb.pdf', 1, CCB_CONSIGNADO), pagina('ccb.pdf', 2, 'Saldo remanescente: R$ 290,00\r\n')]).campos.valor_total;
    expect(v.valor).toBe('V');
  });
  test('bilhete de seguro não concorre com a CCB', () => {
    const res = rodar('345.67', '2026-10-10', [pagina('ccb.pdf', 1, CCB_CONSIGNADO), pagina('seguro.pdf', 1, BILHETE_SEGURO)]);
    expect(res.candidatos.lastro.processed_pdf).toBe('ccb.pdf');
    expect(res.confianca).toBe('alta');
  });
});

describe('termo de endosso, CPR, linha do termo', () => {
  const TERMO_ENDOSSO = 'TERMO DE ENDOSSO E AQUISIÇÃO DE DIREITOS CREDITÓRIOS SEM COOBRIGAÇÃO\r\n'
    + 'I – ENDOSSANTE: BETA SOLUÇÕES DIGITAIS SOCIEDADE DE CRÉDITO DIRETO S/A, inscrita no CNPJ/ME sob o nº 22.333.444/0001-05\r\n'
    + 'II - FUNDO ALFA FIDC inscrito no CNPJ/ME sob o nº 11.444.777/0001-61\r\n'
    + 'São Paulo, 15 de julho de 2026.\r\n'
    + 'ANEXO A: RELAÇÃO DOS DIREITOS CREDITÓRIOS\r\n'
    + 'NOME DO DEVEDOR SÉRIE/NÚMERO DA CCB VENCIMENTO VALOR BRUTO VALOR LÍQUIDO\r\n'
    + '12345678909 - JOANA MARIA PEREIRA 2345678901 10/07/2027 4148,04 3120,55\r\n'
    + '98765432100 - OUTRO DEVEDOR QUALQUER 2345678999 10/01/2027 1200,00 980,00\r\n';

  test('linha da CCB achada pelo número dentro do da amostra', () => {
    const res = pre([registro(1, 'termo_cessao', {
      numero_documento: "'990012345678901003", sacado_nome: 'JOANA MARIA PEREIRA', sacado_documento: '123.456.789-09',
      valor_total: '345.67', data_vencimento: '2026-10-10', data_aquisicao: '2026-07-15', nome_fundo: 'FUNDO ALFA FIDC',
      cnpj_fundo: '11.444.777/0001-61', tipo_recebivel: 'CCB PRE DIGITAL',
    })], [pagina('termo.pdf', 1, TERMO_ENDOSSO)], { tiposPdf: { 'termo.pdf': true } }).resultados[0];
    expect(res.campos.numero_documento.valor).toBe('V');
    expect(res.confianca).toBe('alta');
    const aq = res.campos.data_aquisicao;
    expect([aq.valor, aq.confirmado_por.rotulo]).toEqual(['V', 'Data do termo (local e data)']);
  });

  const CPR_F = 'CÉDULA DE PRODUTO RURAL COM LIQUIDAÇÃO FINANCEIRA Nº CR123456\r\n'
    + '1. DATA DE VENCIMENTO: 10/03/2027\r\n2. DATA DE EMISSÃO: 05/08/2026\r\n'
    + '4. EMITENTE: NOME/RAZÃO SOCIAL: PEDRO HENRIQUE ALVES CPF/CNPJ: 123.456.789-09\r\n'
    + '5. CREDOR: RAZÃO SOCIAL: GAMMA FUNDO DE INVESTIMENTO EM DIREITOS CREDITÓRIOS CNPJ: 11.444.777/0001-61\r\n'
    + '12. VALOR NOMINAL DA CPR-F: R$ 22.000,00\r\n';

  test('a CPR serve de termo e o fundo é o credor', () => {
    const regs = ['lastro', 'termo_cessao'].map((t) => registro(1, t, {
      numero_documento: 'CR123456-1', sacado_nome: 'PEDRO HENRIQUE ALVES', sacado_documento: '123.456.789-09', valor_total: '22000.00',
      data_emissao: '2026-08-05', data_vencimento: '2027-03-10', data_aquisicao: '2026-08-05', nome_fundo: 'FIDC GAMMA',
      cnpj_fundo: '11.444.777/0001-61', tipo_recebivel: 'CPRf',
    }));
    const res = pre(regs, [pagina('cpr.pdf', 1, CPR_F)], { tiposPdf: { 'cpr.pdf': false } }).resultados[0];
    expect(res.candidatos.termo.processed_pdf).toBe('cpr.pdf');
    expect(res.candidatos.lastro.processed_pdf).toBe('cpr.pdf');
    expect([res.campos.numero_documento.valor, res.campos.numero_documento.regra]).toEqual(['V', 'numero_com_parcela']);
    expect([res.campos.nome_cessionario.valor, res.campos.doc_cessionario.valor]).toEqual(['V', 'V']);
  });

  const TERMO_CCB_TABELA = 'TERMO DE CESSÃO E AQUISIÇÃO DE DIREITOS CREDITÓRIOS\r\n'
    + 'CEDENTE: DELTA SOCIEDADE DE CRÉDITO DIRETO S.A.\r\n'
    + 'Nº DA CCB EMITENTE CNPJ/CPF DO EMITENTE VALOR PRINCIPAL\r\n'
    + '7654321 JOANA MARIA PEREIRA 123.456.789-09 500,00 10/09/2026\r\n'
    + '7654999 OUTRO EMITENTE QUALQUER 987.654.321-00 900,00 10/10/2026\r\n';
  const linhaDoTermo = (tipo: string, paginas: any[] | null = null) => {
    const pgs = paginas ?? [pagina('termo.pdf', 1, TERMO_CCB_TABELA)];
    return pre([registro(1, 'termo_cessao', {
      numero_documento: '99887766', sacado_nome: 'JOANA MARIA PEREIRA', sacado_documento: '123.456.789-09',
      cedente_documento: '22.333.444/0001-05', valor_total: '500.00', data_vencimento: '2026-09-10', tipo_recebivel: tipo,
    })], pgs, { tiposPdf: tipos(pgs, () => true) }).resultados[0];
  };

  test('na CCB emitente não é rótulo do cedente', () => {
    expect(linhaDoTermo('CCB PRE DIGITAL').campos.cedente_documento.valor).not.toBe('D');
  });
  test('nº impresso na linha vira a correção', () => {
    const n = linhaDoTermo('NOTA DE DÉBITO').campos.numero_documento;
    expect([n.valor, n.encontrado]).toEqual(['D', '7654321']);
  });
  test('na duplicata o nº da linha não corrige', () => {
    expect(linhaDoTermo('DUPLICATA').campos.numero_documento.encontrado).not.toBe('7654321');
  });
  test('cópias do mesmo termo não são ambiguidade', () => {
    let linhas = '';
    for (let i = 0; i < 12; i++) {
      linhas += `${7650000 + i} DEVEDOR NUMERO ${i} ${String(100 + i).padStart(3, '0')}.456.789-${String(i).padStart(2, '0')} ${100 + i},00 10/0${1 + (i % 9)}/2027\r\n`;
    }
    const corpo = TERMO_CCB_TABELA + linhas;
    const paginas = [pagina('termo_a.pdf', 1, `Documento AX7K-2Q9 - página 1/1\r\n${corpo}`),
      pagina('termo_b.pdf', 1, `Documento ZT4M-8W1 - página 1/2\r\n${corpo}`),
      pagina('termo_b.pdf', 2, 'Assinaturas eletrônicas registradas em 15/07/2026.\r\n')];
    expect(linhaDoTermo('NOTA DE DÉBITO', paginas).confianca).not.toBe('ambigua');
  });
});

describe('busca do valor', () => {
  const rodar = (paginas: any[], valor = '290.00', leituras: any = null, tipo = 'lastro', vencimento = '2026-10-10') => pre([registro(1, tipo, {
    numero_documento: "'990012345678901003", sacado_nome: 'JOANA MARIA PEREIRA', sacado_documento: '123.456.789-09',
    valor_total: valor, data_vencimento: vencimento, tipo_recebivel: 'CCB PRE DIGITAL',
  })], paginas, { tiposPdf: tipos(paginas, (p) => p.startsWith('termo')), leituras }).resultados[0].campos.valor_total;

  test('valor em outro documento do mesmo título', () => {
    const aditamento = 'ADITAMENTO À CÉDULA DE CRÉDITO BANCÁRIO Nº 0012345678901\r\nEMITENTE: JOANA MARIA PEREIRA CPF 123.456.789-09\r\n'
      + 'Saldo da parcela renegociada: R$ 290,00\r\n';
    const v = rodar([pagina('ccb.pdf', 1, CCB_CONSIGNADO), pagina('aditamento.pdf', 1, aditamento)]);
    expect(v.valor).toBe('V');
    expect(v.evidencias[0][0]).toBe(1);
  });
  test('valor em outra CCB do mesmo cliente não conta', () => {
    const outra = CCB_CONSIGNADO.replace('0012345678901', '0099999999999').replace('345,67', '290,00');
    expect(rodar([pagina('ccb.pdf', 1, CCB_CONSIGNADO), pagina('outra.pdf', 1, outra)]).valor).toBe('P');
  });
  test('valor de encargo não conta', () => {
    expect(rodar([pagina('ccb.pdf', 1, `${CCB_CONSIGNADO}IOF (financiado): 290,00 1,20 %*\r\n`)]).valor).toBe('P');
  });
  test('valor no padrão americano sem R$', () => {
    expect(rodar([pagina('ccb.pdf', 1, `${CCB_CONSIGNADO}Saldo da parcela 290.00\r\n`)]).valor).toBe('V');
  });
  test('valor só na leitura da IA', () => {
    const v = rodar([pagina('ccb.pdf', 1, CCB_CONSIGNADO)], '290.00', [{ pdf: 'escaneado.pdf', documento: '123.456.789-09', valor: '290.00' }]);
    expect([v.valor, v.regra, v.fonte.arquivo]).toEqual(['V', 'valor_na_leitura_ia', 'escaneado.pdf']);
  });
  test('não achado é pendência com o registro da busca', () => {
    const v = rodar([pagina('ccb.pdf', 1, `${CCB_CONSIGNADO}Saldo da parcela R$ 289,99\r\n`)], '290.00',
      [{ pdf: 'ccb.pdf', documento: '123.456.789-09', valor: '345.67' }]);
    expect(v.valor).toBe('P');
    expect([v.busca.documentos, v.busca.leituras_ia]).toEqual([1, 1]);
    expect(v.busca.proximo.valor).toBe('289.99');
  });
  test('linha de outro título do mesmo devedor não conta', () => {
    const termo = 'TERMO DE CESSÃO\r\nRELAÇÃO DE TÍTULOS\r\n'
      + '0012345678901 JOANA MARIA PEREIRA 123.456.789-09 R$ 300,00 10/10/2026\r\n'
      + '9999999999 JOANA MARIA PEREIRA 123.456.789-09 R$ 290,00 10/01/2027\r\n'
      + '8888888888 OUTRO DEVEDOR 987.654.321-00 R$ 410,00 10/02/2027\r\n';
    expect(rodar([pagina('termo.pdf', 1, termo)], '290.00', null, 'termo_cessao').valor).toBe('P');
  });
});

describe('valor cheio e sem termo', () => {
  const cheio = (termo: string) => pre([registro(1, 'termo_cessao', {
    numero_documento: '55443322', sacado_nome: 'JOANA MARIA PEREIRA', sacado_documento: '123.456.789-09', valor_total: '284.23',
    data_vencimento: '2026-09-10', tipo_recebivel: 'NOTA DE DÉBITO',
  })], [pagina('termo.pdf', 1, termo)], { tiposPdf: { 'termo.pdf': true } }).resultados[0].campos.valor_total;

  test('valor cheio dividido pelas parcelas impressas confere', () => {
    const v = cheio('TERMO DE CESSÃO\r\nDEVEDOR: JOANA MARIA PEREIRA CPF 123.456.789-09 Nº 55443322\r\n'
      + 'VALOR TOTAL: R$ 2.842,30 EM 10 (DEZ) PARCELAS MENSAIS, 1º VENCIMENTO 10/09/2026\r\n');
    expect([v.valor, v.regra, v.parcelas]).toEqual(['V', 'valor_cheio_dividido', 10]);
  });
  test('sem a quantidade impressa não divide', () => {
    expect(cheio('TERMO DE CESSÃO\r\nDEVEDOR: JOANA MARIA PEREIRA CPF 123.456.789-09 Nº 55443322\r\n'
      + 'VALOR TOTAL: R$ 2.842,30 VENCIMENTO 10/09/2026\r\n').valor).toBe('P');
  });
  test('sem termo achado os campos do termo ficam V pela amostra', () => {
    const regs = ['lastro', 'termo_cessao'].map((t) => registro(1, t, {
      numero_documento: "'990012345678901003", sacado_nome: 'JOANA MARIA PEREIRA', sacado_documento: '123.456.789-09',
      valor_total: '345.67', data_vencimento: '2026-10-10', data_aquisicao: '2026-07-15', nome_fundo: 'FUNDO ALFA FIDC',
      cnpj_fundo: '11.444.777/0001-61', tipo_recebivel: 'CONFISSÃO DE DÍVIDA',
    }));
    const res = pre(regs, [pagina('ccb.pdf', 1, CCB_CONSIGNADO)], { tiposPdf: { 'ccb.pdf': false } }).resultados[0];
    expect(res.candidatos).not.toHaveProperty('termo');
    for (const c of ['nome_cessionario', 'doc_cessionario', 'data_aquisicao']) expect([res.campos[c].valor, res.campos[c].regra], c).toEqual(['V', 'termo_pela_amostra']);
  });
});
