/* eslint-disable @typescript-eslint/no-explicit-any */
/** Porta de backend/tests/test_pre_classificacao.py (dados fictícios). */
import { describe, expect, test } from 'vitest';
import { extrairCodigos, extrairDatas, extrairMoedas } from './formas';
import { chavesDocumento, naoEncontradoViraD, parcelaNaTabela, preClassificarNucleo } from './motor';
import { normalizarTexto } from './valores';
import { CCB, DUPLICATA, TERMO_ANEXO_MULTILINHA, TERMO_CODIGOS, TERMO_QUADRO_RESUMO, pagina, registro, registroTermo, valores, vd } from './testes-util';

const TERMO_P1 = (
  'TERMO DE CESSÃO DE DIREITOS CREDITÓRIOS\r\n'
  + 'CESSIONÁRIA: FUNDO ALFA FIDC CNPJ 11.444.777/0001-61\r\n'
  + 'Data de aquisição: 05/08/2026\r\n'
);
const TERMO_P2 = (
  'ANEXO I - RELAÇÃO DE TÍTULOS\r\n'
  + '52623-05 MERCEARIA BOM PRECO COMERCIO VAREJISTA 12.345.678/0001-95 R$ 2.000,00 10/09/2026\r\n'
  + '52623-06 MERCEARIA BOM PRECO COMERCIO VAREJISTA 12.345.678/0001-95 R$ 2.500,00 10/10/2026\r\n'
  + '77777-01 OUTRO SACADO QUALQUER SA 98.765.432/0001-10 R$ 999,90 11/11/2026\r\n'
);

const pre = (regs: any[], paginas: any[], opcoes: any = {}) => preClassificarNucleo(regs, paginas, opcoes);

describe('extração', () => {
  test('datas em vários formatos', () => {
    const texto = normalizarTexto('venc 05/09/2026, emissão 5.8.26 e 1 de março de 2026; inválida 31/02/2026');
    expect(extrairDatas(texto).map(([, d]) => d)).toEqual(['2026-09-05', '2026-08-05', '2026-03-01']);
  });
  test('moeda pt-BR', () => {
    expect(extrairMoedas('R$ 1.613,33 e 475,00 mas não 1613.33 nem 12,345').map(([, v]) => v)).toEqual(['1613.33', '475.00']);
  });
  test('documento ignora prefixo e zeros', () => {
    expect(chavesDocumento("'0052635-01")).toEqual({
      grupos: ['52635', '1'], corrido: '5263501', principal: '52635', trivial: false, digitos: '005263501', codigo: null,
    });
    expect(chavesDocumento('0')!.trivial).toBe(true);
  });
  test('documento com letras vira código', () => {
    expect(chavesDocumento("'12C3-45678")!.codigo).toBe('12c345678');
    expect(chavesDocumento('CCB-1')!.codigo).toBeNull();
    expect(extrairCodigos('ccb nº 12c3-45678 cpf 123.456.789-09 r$ 1.234,56 10/09/2026').map(([, , c]) => c)).toEqual(['12c345678']);
  });
});

describe('pré-classificação', () => {
  test('lastro único com divergência no vencimento', () => {
    const paginas = [pagina('dup.pdf', 1, DUPLICATA), pagina('outro.pdf', 1, 'NADA A VER 123,45')];
    const r = pre([registro(1, 'duplicata', {
      numero_documento: "'52635-01", valor_total: '1613.33', data_vencimento: '2026-08-05', data_emissao: '2026-08-05',
      sacado_documento: '33.444.555/0002-07', sacado_nome: 'EXEMPLO ACADEMIA DE GINASTICA LTDA',
      cedente_documento: '11.222.333/0001-81', cedente_nome: 'PAPELARIA MODELO LTDA',
    })], paginas);
    const res = r.resultados[0];
    expect(res.candidatos.lastro.processed_pdf).toBe('dup.pdf');
    expect(res.confianca).toBe('alta');
    const v = valores(res);
    for (const c of ['numero_documento', 'valor_total', 'data_emissao', 'sacado_documento', 'sacado_nome', 'cedente_nome']) expect(v[c], c).toBe('V');
    const venc = res.campos.data_vencimento;
    expect([venc.valor, venc.alerta.encontrado]).toEqual(['V', '2026-09-05']);
    expect(venc.fonte.tipo).toBe('amostra');
  });

  test('código alfanumérico acha a linha do título no termo', () => {
    const paginas = [pagina('termo.pdf', 1, TERMO_CODIGOS)];
    const res = pre([registro(3, 'termo_cessao', {
      numero_documento: "'3C4D-40002", valor_total: '1500', data_vencimento: '2026-11-10', sacado_documento: '111.444.777-35',
      sacado_nome: 'MARIA ALVES COSTA', nome_fundo: 'FUNDO ALFA FIDC RL', cnpj_fundo: '11.444.777/0001-61',
    })], paginas).resultados[0];
    const numero = res.campos.numero_documento;
    expect([numero.valor, numero.regra ?? null]).toEqual(['V', null]);
    const [, ini, fim] = numero.evidencias[0];
    expect(paginas[0].texto.slice(ini, fim)).toBe('3c4d-40002');
    expect(res.confianca).not.toBe('baixa');
  });

  test('valor que o termo não traz confere na CCB do título', () => {
    const ccb = 'CÉDULA DE CRÉDITO BANCÁRIO Nº 3C4D-40002\r\nEMITENTE MARIA ALVES COSTA CPF 111.444.777-35\r\nVALOR DA PARCELA R$ 333,33\r\n';
    const paginas = [pagina('termo.pdf', 1, TERMO_CODIGOS), pagina('ccb.pdf', 1, ccb)];
    const res = pre([registro(4, 'termo_cessao', {
      numero_documento: "'3C4D-40002", valor_total: '333.33', sacado_documento: '111.444.777-35', sacado_nome: 'MARIA ALVES COSTA',
      nome_fundo: 'FUNDO ALFA FIDC RL', cnpj_fundo: '11.444.777/0001-61',
    })], paginas, { tiposPdf: { 'termo.pdf': true, 'ccb.pdf': false } }).resultados[0];
    const valor = res.campos.valor_total;
    expect([valor.valor, valor.origem]).toEqual(['V', 'referencia']);
    expect(res.candidatos.referencia.processed_pdf).toBe('ccb.pdf');
    const [, ini, fim] = valor.evidencias[0];
    expect(paginas[1].texto.slice(ini, fim)).toBe('333,33');
  });

  test('nome abreviado ao lado do CPF confere', () => {
    const dup = 'DUPLICATA MERCANTIL Nº 70009\r\nEMITENTE PAPELARIA MODELO LTDA CNPJ 11.222.333/0001-81\r\n'
      + 'SACADO MARIA A. COSTA CPF 111.444.777-35\r\nVENCIMENTO 10/09/2026 VALOR R$ 500,00\r\n';
    const nome = (sacado: string) => pre([registro(1, 'duplicata', {
      numero_documento: '70009', valor_total: '500', data_vencimento: '2026-09-10', sacado_documento: '111.444.777-35', sacado_nome: sacado,
    })], [pagina('dup.pdf', 1, dup)]).resultados[0].campos.sacado_nome;
    const parcial = nome('MARIA APARECIDA ALVES COSTA');
    expect([parcial.valor, parcial.regra]).toEqual(['V', 'nome_parcial_com_cpf']);
    expect(nome('JOAO PEREIRA DIAS').valor).not.toBe('V');
  });

  test('fundo com outro nome e mesmo CNPJ no termo confere', () => {
    const termo = TERMO_CODIGOS.replace(/FUNDO ALFA FIDC/g, 'FUNDO BETA FIDC');
    const res = pre([registro(3, 'termo_cessao', {
      numero_documento: "'3C4D-40002", valor_total: '1500', sacado_documento: '111.444.777-35', sacado_nome: 'MARIA ALVES COSTA',
      nome_fundo: 'FUNDO ALFA FIDC RL', cnpj_fundo: '11.444.777/0001-61',
    })], [pagina('termo.pdf', 1, termo)]).resultados[0];
    expect([res.campos.nome_cessionario.valor, res.campos.nome_cessionario.regra]).toEqual(['V', 'cessionario_pelo_cnpj']);
  });

  test('CNPJ da mesma empresa em outra filial confere', () => {
    const r = pre([registro(1, 'duplicata', {
      numero_documento: "'52635-01", valor_total: '1613.33', sacado_documento: '33.444.555/0001-81', cedente_documento: '11.222.333/0001-81',
    })], [pagina('dup.pdf', 1, DUPLICATA)]);
    const doc = r.resultados[0].campos.sacado_documento;
    expect([doc.valor, doc.regra]).toEqual(['V', 'cnpj_mesma_raiz']);
  });

  test('termo usa a linha do título e não a página', () => {
    const paginas = [pagina('termo.pdf', 1, TERMO_P1), pagina('termo.pdf', 2, TERMO_P2)];
    const res = pre([registro(2, 'termo_cessao', {
      numero_documento: '52623-05', valor_total: '2000', data_vencimento: '2026-09-10', sacado_documento: '12345678000195',
      sacado_nome: 'MERCEARIA BOM PRECO COMERCIO VAREJISTA DE AR', data_aquisicao: '2026-08-05',
      nome_fundo: 'FUNDO ALFA FIDC RL', cnpj_fundo: '11.444.777/0001-61',
    })], paginas).resultados[0];
    expect([res.candidatos.termo.processed_pdf, res.candidatos.termo.pagina]).toEqual(['termo.pdf', 2]);
    const v = valores(res);
    for (const c of ['numero_documento', 'valor_total', 'data_vencimento', 'sacado_documento', 'sacado_nome', 'data_aquisicao',
      'doc_cessionario', 'nome_cessionario']) expect(v[c], c).toBe('V');
  });

  test('valor divergente na linha do termo', () => {
    const paginas = [pagina('termo.pdf', 1, TERMO_P1), pagina('termo.pdf', 2, TERMO_P2)];
    const res = pre([registro(3, 'termo_cessao', {
      numero_documento: '52623-06', valor_total: '2400', data_vencimento: '2026-10-10', sacado_documento: '12345678000195',
    })], paginas).resultados[0];
    expect(vd(res.campos.valor_total)).toEqual({ valor: 'P', encontrado: null });
    expect(res.campos.data_vencimento.valor).toBe('V');
  });

  test('valor de outra linha não vira V', () => {
    const paginas = [pagina('termo.pdf', 1, TERMO_P1), pagina('termo.pdf', 2, TERMO_P2)];
    const r = pre([registro(9, 'termo_cessao', {
      numero_documento: '52623-06', valor_total: '2000', data_vencimento: '2026-10-10', sacado_documento: '12345678000195',
    })], paginas);
    expect(vd(r.resultados[0].campos.valor_total)).toEqual({ valor: 'P', encontrado: null });
  });

  test('termo não casa com PDF de lastro', () => {
    const r = pre([registro(4, 'termo_cessao', { numero_documento: '52635-01', valor_total: '1613.33', data_vencimento: '2026-09-05' })],
      [pagina('dup.pdf', 1, DUPLICATA)]);
    expect(r.resultados[0].confianca).toBe('sem_candidato');
  });

  test('mesmo documento subido duas vezes não é ambíguo', () => {
    const r = pre([registro(5, 'duplicata', { numero_documento: '52635-01', valor_total: '1613.33', data_vencimento: '2026-09-05' })],
      [pagina('a.pdf', 1, DUPLICATA), pagina('b.pdf', 1, DUPLICATA)], { pdfsComLeitura: ['b.pdf'] });
    expect(r.resultados[0].confianca).toBe('alta');
    expect(r.resultados[0].candidatos.lastro.processed_pdf).toBe('b.pdf');
  });

  test('dois documentos diferentes empatados ficam ambíguos', () => {
    const outra = DUPLICATA.replace('EXEMPLO', 'OUTRA ACADEMIA');
    const r = pre([registro(6, 'duplicata', { numero_documento: '52635-01', valor_total: '1613.33', data_vencimento: '2026-09-05' })],
      [pagina('a.pdf', 1, DUPLICATA), pagina('b.pdf', 1, outra)]);
    expect(r.resultados[0].confianca).toBe('ambigua');
  });

  test('só número principal não vira V', () => {
    const nf = 'DANFE NOTA FISCAL Nº 000.052.635\r\nVALOR TOTAL DA NOTA 1.613,33\r\nVENCIMENTO 05/09/2026';
    const res = pre([registro(7, 'duplicata', { numero_documento: '52635-01', valor_total: '1613.33', data_vencimento: '2026-09-05' })],
      [pagina('nf.pdf', 1, nf)]).resultados[0];
    expect(res.candidatos.lastro.processed_pdf).toBe('nf.pdf');
    expect(vd(res.campos.numero_documento)).toEqual({ valor: 'D', encontrado: '' });
    expect(res.campos.valor_total.valor).toBe('V');
  });

  test('pendência nos dois tipos ganha um candidato por tipo', () => {
    const termo2 = TERMO_P2.replace('52623-05', '52635-01').replace('2.000,00', '1.613,33').replace('10/09/2026', '05/09/2026');
    const paginas = [pagina('dup.pdf', 1, DUPLICATA), pagina('termo.pdf', 1, TERMO_P1), pagina('termo.pdf', 2, termo2)];
    const campos = { numero_documento: '52635-01', valor_total: '1613.33', data_vencimento: '2026-09-05', data_aquisicao: '2026-08-05' };
    const r = pre([registro(8, 'duplicata', campos), registro(8, 'termo_cessao', campos)], paginas);
    expect(r.total).toBe(1);
    const res = r.resultados[0];
    expect(res.candidatos.lastro.processed_pdf).toBe('dup.pdf');
    expect(res.candidatos.termo.processed_pdf).toBe('termo.pdf');
    expect(res.campos.data_aquisicao.valor).toBe('V');
  });
});



const paginasTermo = () => [pagina('termo.pdf', 1, TERMO_QUADRO_RESUMO), pagina('termo.pdf', 2, TERMO_ANEXO_MULTILINHA)];

describe('layouts reais', () => {
  test('moeda padrão americano só colada ao R$', () => {
    expect(extrairMoedas('r$ 285.10 / r$ 1,380.65 / 1613.33 solto').map(([, v]) => v)).toEqual(['285.10', '1380.65']);
  });

  test('título em várias linhas pega o nome e a parcela certa', () => {
    const res = pre([registroTermo(10, '2029-01-21')], paginasTermo()).resultados[0];
    const v = valores(res);
    for (const c of ['sacado_nome', 'sacado_documento', 'valor_total', 'data_vencimento', 'cedente_nome', 'cedente_documento',
      'data_aquisicao', 'nome_cessionario', 'doc_cessionario']) expect(v[c], c).toBe('V');
    expect(res.candidatos.termo.trecho).toContain('21/01/2029');
    expect(res.confianca).toBe('alta');
  });

  test('evidência aponta o texto de cada valor', () => {
    const paginas = paginasTermo();
    const res = pre([registroTermo(23, '2029-01-21')], paginas).resultados[0];
    const texto: Record<number, string> = Object.fromEntries(paginas.map((pg) => [pg.numero, pg.texto]));
    const trechos = (campo: string) => res.campos[campo].evidencias.map(([pg, a, b]: number[]) => texto[pg].slice(a, b));
    expect(trechos('valor_total')).toEqual(['111,47']);
    expect(trechos('data_vencimento')).toEqual(['21/01/2029']);
    expect(trechos('sacado_documento')).toEqual(['111.222.333-96']);
    expect([...trechos('sacado_nome')].sort()).toEqual(['aparecida', 'fonseca', 'lima', 'maria']);
    expect(trechos('doc_cessionario')).toEqual(['11444777000161']);
    const [paginaRegiao, ini, fim] = res.candidatos.termo.regiao;
    expect(paginaRegiao).toBe(2);
    expect(texto[2].slice(ini, fim)).toContain('maria aparecida');
    expect(texto[2].slice(ini, fim)).toContain('21/01/2029');
  });

  const aquisicao = (quadro: string, ultima: string | null = null, aq = '2026-08-20') => {
    const paginas = [pagina('termo.pdf', 1, quadro), pagina('termo.pdf', 2, TERMO_ANEXO_MULTILINHA)];
    if (ultima) paginas.push(pagina('termo.pdf', 3, ultima));
    const reg = registroTermo(30, '2029-01-21');
    reg.base_data_aquisicao = aq;
    return pre([reg], paginas).resultados[0].campos.data_aquisicao;
  };

  test('aquisição explícita é a data de pagamento', () => {
    const quadro = TERMO_QUADRO_RESUMO.replace('data de aquisicao: 20/08/2026', 'data de pagamento: 20/08/2026');
    let status = aquisicao(quadro);
    expect(status.valor).toBe('V');
    expect(status.confirmado_por.rotulo).toBe('Data de Pagamento / aquisição do termo');
    status = aquisicao(quadro, null, '2026-08-24');
    expect([status.valor, status.alerta.encontrado]).toEqual(['V', '2026-08-20']);
  });

  test('contrato-mãe "firmado em" não é a aquisição', () => {
    const quadro = TERMO_QUADRO_RESUMO.replace('data de aquisicao: 20/08/2026',
      'nos termos do contrato de aquisicao de direitos creditorios, firmado em 11/05/2026');
    const status = aquisicao(quadro, 'assinado em: 20/08/2026');
    expect([status.valor, status.regra]).toEqual(['V', 'data_assinatura']);
  });

  test('sem aquisição explícita a assinatura diferente vira alerta', () => {
    const quadro = TERMO_QUADRO_RESUMO.replace('data de aquisicao: 20/08/2026', '');
    const status = aquisicao(quadro, 'enviado em 30/07/2026\r\nassinado em: 31/07/2026');
    expect([status.valor, status.alerta.encontrado, status.alerta.regra]).toEqual(['V', '2026-07-31', 'data_assinatura']);
  });

  test('sem aquisição nem assinatura vale a emissão', () => {
    const quadro = TERMO_QUADRO_RESUMO.replace('data de aquisicao: 20/08/2026', 'data de emissao: 20/08/2026');
    const status = aquisicao(quadro);
    expect([status.valor, status.regra]).toEqual(['V', 'aquisicao_igual_emissao']);
  });

  test('documento zero não vira V nem âncora', () => {
    const status = pre([registroTermo(11, '2029-01-21')], paginasTermo()).resultados[0].campos.numero_documento;
    expect([status.valor, status.encontrado, status.regra]).toEqual(['D', '', 'ausente_no_documento']);
  });

  test('parcela fora do índice em termo confirmado pela data de pagamento', () => {
    const res = pre([registroTermo(12, '2029-02-21')], paginasTermo()).resultados[0];
    const termo = res.candidatos.termo;
    expect(res.confianca).not.toBe('baixa');
    expect(termo.aviso).toBe('parcela_fora_do_indice');
    expect(termo.regiao).toBeNull();
    expect(termo.evidencias.length).toBeGreaterThan(0);
    expect(termo.evidencias.every(([, pg]: any[]) => pg === 1)).toBe(true);
  });

  test('parcela que não está no termo não passa de baixa', () => {
    const reg = registroTermo(12, '2029-02-21');
    reg.base_data_aquisicao = '2026-08-24';
    const res = pre([reg], paginasTermo()).resultados[0];
    expect(res.campos.data_vencimento.fonte.tipo).toBe('amostra');
    expect(res.confianca).toBe('baixa');
  });

  test('emissão da amostra vale mesmo que o termo não traga', () => {
    const emissao = pre([registroTermo(13, '2029-01-21')], paginasTermo()).resultados[0].campos.data_emissao;
    expect([emissao.valor, emissao.fonte.tipo]).toEqual(['V', 'amostra']);
    expect(emissao).not.toHaveProperty('alerta');
  });

  const ccb = (rid: number, vencimento: string | null = null, tipoRecebivel = 'CCB Digital') => pre([registro(rid, 'lastro', {
    numero_documento: '0', valor_total: '111.47', data_emissao: '2026-03-28', data_vencimento: vencimento, tipo_recebivel: tipoRecebivel,
    sacado_documento: '111.222.333-96', sacado_nome: 'MARIA APARECIDA FONSECA LIMA',
  })], [pagina('ccb.pdf', 1, CCB)]).resultados[0].campos;

  const ccbTexto = (rid: number, vencimento: string | null, texto: string, emissao = '2026-03-28') => pre([registro(rid, 'lastro', {
    numero_documento: '0', valor_total: '111.47', data_emissao: emissao, data_vencimento: vencimento, tipo_recebivel: 'CCB Digital',
    sacado_documento: '111.222.333-96', sacado_nome: 'MARIA APARECIDA FONSECA LIMA',
  })], [pagina('ccb.pdf', 1, texto)]).resultados[0].campos;

  test('CCB Digital tem nº do documento sempre zero', () => {
    expect(ccb(15).numero_documento.valor).toBe('V');
    expect(vd(ccb(16, null, 'Duplicata').numero_documento)).toEqual({ valor: 'D', encontrado: '' });
  });

  test('vencimento igual ao final da CCB confere', () => {
    expect(ccb(17, '2027-05-21').data_vencimento.valor).toBe('V');
  });

  test('parcela do cronograma confere', () => {
    const status = ccb(18, '2026-11-21').data_vencimento;
    expect(status.valor).toBe('V');
    expect(status.fonte.tipo).toBe('amostra');
    expect(status.confirmado_por.rotulo).toBe('Cronograma de parcelas');
    expect(status).not.toHaveProperty('alerta');
  });

  test('um dia depois de parcela do meio vira D com a parcela', () => {
    const status = ccb(27, '2026-11-23').data_vencimento;
    expect([status.valor, status.encontrado, status.regra]).toEqual(['D', '2026-11-21', 'planilha_um_dia_depois']);
  });

  test('data que não é parcela vira alerta', () => {
    const status = ccb(28, '2026-11-15').data_vencimento;
    expect(status.valor).toBe('V');
    expect([status.alerta.encontrado, status.alerta.fonte.rotulo]).toEqual(['2027-05-21', 'Vencimento Final']);
  });

  test('sem vencimento final calcula pela quantidade de parcelas', () => {
    const texto = CCB.replace('vencimento final: 21/05/2027 ', '') + 'quantidade de parcelas: 12\r\n';
    expect(texto).not.toContain('vencimento final');
    expect(ccbTexto(19, '2027-05-21', texto).data_vencimento.valor).toBe('V');
  });

  test('planilha sem vencimento sugere o final da CCB', () => {
    const status = ccb(20, null).data_vencimento;
    expect([status.valor, status.encontrado, status.regra]).toEqual(['D', '2027-05-21', 'planilha_vazia_vale_documento']);
  });

  test('planilha sem vencimento no termo sugere a data da linha', () => {
    const status = pre([registroTermo(21, null)], paginasTermo()).resultados[0].campos.data_vencimento;
    expect([status.valor, status.regra]).toEqual(['D', 'planilha_sem_vencimento']);
    expect(status.encontrado).toBeTruthy();
  });

  test('emissão que aparece no termo confere', () => {
    const r = pre([registroTermo(22, '2029-01-21', '2026-08-20')], paginasTermo());
    expect(r.resultados[0].campos.data_emissao.valor).toBe('V');
  });

  test('emissão da amostra vale e a da CCB diferente vira alerta', () => {
    const status = ccbTexto(23, null, CCB, '2026-03-20').data_emissao;
    expect([status.valor, status.alerta.encontrado, status.alerta.regra]).toEqual(['V', '2026-03-28', 'vale_documento_emissao']);
  });

  test('amostra um dia depois da parcela final vira D corrigido', () => {
    const status = ccb(24, '2027-05-22').data_vencimento;
    expect([status.valor, status.encontrado, status.regra]).toEqual(['D', '2027-05-21', 'planilha_um_dia_depois']);
  });

  test('amostra na segunda com parcela no sábado vira D corrigido', () => {
    const texto = CCB.replace('vencimento final: 21/05/2027', 'vencimento final: 22/05/2027');
    const status = ccbTexto(25, '2027-05-24', texto).data_vencimento;
    expect([status.valor, status.encontrado, status.regra]).toEqual(['D', '2027-05-22', 'planilha_um_dia_depois']);
  });

  test('termo um dia depois ainda identifica a parcela', () => {
    const res = pre([registroTermo(26, '2029-01-22')], paginasTermo()).resultados[0];
    const venc = res.campos.data_vencimento;
    expect([venc.valor, venc.regra, venc.data_documento]).toEqual(['V', 'vencimento_um_dia_antes', '2029-01-21']);
    expect(res.candidatos.termo.trecho).toContain('21/01/2029');
    expect(res.confianca).not.toBe('baixa');
  });

  test('data exata ganha da regra do dia seguinte', () => {
    expect(pre([registroTermo(27, '2029-01-21')], paginasTermo()).resultados[0].campos.data_vencimento.valor).toBe('V');
  });

  const termoComCcb = (rid: number, aq: string) => {
    const reg = registroTermo(rid, '2029-01-21');
    reg.base_data_aquisicao = aq;
    return pre([reg], [...paginasTermo(), pagina('ccb.pdf', 1, CCB)]).resultados[0];
  };

  test('termo lê vencimento e emissão na CCB e aquisição no termo', () => {
    const res = termoComCcb(31, '2026-08-20');
    expect(res.campos.data_aquisicao.valor).toBe('V');
    const venc = res.campos.data_vencimento;
    expect([venc.valor, venc.alerta.encontrado]).toEqual(['V', '2027-05-21']);
    expect(res.campos.data_emissao.valor).toBe('V');
    expect(res.candidatos.referencia.processed_pdf).toBe('ccb.pdf');
    expect(res.candidatos.termo.processed_pdf).toBe('termo.pdf');
    expect(res.candidatos).not.toHaveProperty('lastro');
  });

  test('aquisição diferente da data de pagamento vira alerta', () => {
    const aq = termoComCcb(32, '2026-08-24').campos.data_aquisicao;
    expect([aq.valor, aq.alerta.encontrado]).toEqual(['V', '2026-08-20']);
  });

  test('aquisição um dia depois da data de pagamento vira D corrigido', () => {
    const aq = termoComCcb(33, '2026-08-21').campos.data_aquisicao;
    expect([aq.valor, aq.encontrado, aq.regra]).toEqual(['D', '2026-08-20', 'planilha_um_dia_depois']);
  });

  test('CCB Digital', () => {
    const r = pre([registro(14, 'lastro', {
      numero_documento: '0', valor_total: '111.47', data_emissao: '2026-03-28',
      sacado_documento: '111.222.333-96', sacado_nome: 'MARIA APARECIDA FONSECA LIMA',
      cedente_nome: 'CREDORA BETA SOCIEDADE DE CREDITO DIRETO S.A', cedente_documento: '22.333.444/0001-81',
    })], [pagina('ccb.pdf', 1, CCB)]);
    const v = valores(r.resultados[0]);
    for (const c of ['sacado_nome', 'sacado_documento', 'cedente_nome', 'cedente_documento', 'valor_total', 'data_emissao']) expect(v[c], c).toBe('V');
  });
});

describe('fontes das datas', () => {
  const rodar = (vencimento: string | null, origens: any = null) => pre([registro(40, 'lastro', {
    numero_documento: '0', valor_total: '111.47', data_emissao: '2026-03-20', data_vencimento: vencimento, tipo_recebivel: 'CCB Digital',
    sacado_documento: '111.222.333-96', sacado_nome: 'MARIA APARECIDA FONSECA LIMA',
  })], [pagina('ccb.pdf', 1, CCB)], { origens }).resultados[0].campos;

  test('data da amostra diz a coluna escolhida no upload', () => {
    const origens = [{ registro_base_id: 0, campo: 'DATA_VENCIMENTO_ORIGINAL', coluna_arquivo: 'DATA_VENCIMENTO_ORIGINAL' }];
    expect(rodar('2027-05-21', origens).data_vencimento.fonte).toEqual({ tipo: 'amostra', coluna: 'DATA_VENCIMENTO_ORIGINAL', motivo: null });
  });

  test('linha que veio da outra coluna diz o motivo', () => {
    const origens = [
      { registro_base_id: 0, campo: 'DATA_VENCIMENTO_ORIGINAL', coluna_arquivo: 'DATA_VENCIMENTO_ORIGINAL' },
      { registro_base_id: 40, campo: 'DATA_VENCIMENTO_ORIGINAL', coluna_arquivo: 'DATA_VENCIMENTO_AJUSTADA' },
    ];
    const fonte = rodar('2027-05-21', origens).data_vencimento.fonte;
    expect(fonte.coluna).toBe('DATA_VENCIMENTO_AJUSTADA');
    expect(fonte.motivo).toContain('DATA_VENCIMENTO_ORIGINAL');
  });

  test('vencimento confirmado pelo documento', () => {
    const venc = rodar('2027-05-21').data_vencimento;
    expect(venc.valor).toBe('V');
    expect([venc.confirmado_por.arquivo, venc.confirmado_por.rotulo]).toEqual(['ccb.pdf', 'Cronograma de parcelas']);
  });

  test('sem data na amostra a sugestão vem do documento e diz qual', () => {
    const venc = rodar(null).data_vencimento;
    expect([venc.valor, venc.encontrado]).toEqual(['D', '2027-05-21']);
    expect(venc.fonte).toEqual({ tipo: 'documento', arquivo: 'ccb.pdf', pagina: 1, rotulo: 'Vencimento Final' });
  });

  test('alerta de emissão diz o documento', () => {
    const emissao = rodar(null).data_emissao;
    expect([emissao.valor, emissao.alerta.encontrado]).toEqual(['V', '2026-03-28']);
    expect(emissao.alerta.fonte.rotulo).toBe('Data de Emissão');
  });
});

describe('amostra primeiro', () => {
  const termo = (rid: number, emissao: string | null, aq: string | null) => {
    const linha = registroTermo(rid, '2029-01-21', emissao);
    linha.base_data_aquisicao = aq;
    return pre([linha], paginasTermo()).resultados[0].campos;
  };

  test('emissão vazia usa a aquisição da amostra', () => {
    const emissao = termo(50, null, '2026-08-20').data_emissao;
    expect([emissao.valor, emissao.encontrado, emissao.regra]).toEqual(['D', '2026-08-20', 'amostra_outra_coluna']);
    expect(emissao.fonte.coluna).toBe('DATA_AQUISICAO');
    expect(emissao.fonte.motivo).toContain('DATA_EMISSAO');
  });

  test('aquisição vazia usa a emissão da amostra', () => {
    const aq = termo(51, '2026-03-28', null).data_aquisicao;
    expect([aq.valor, aq.encontrado, aq.fonte.coluna]).toEqual(['D', '2026-03-28', 'DATA_EMISSAO']);
  });

  test('sem nenhuma das duas a sugestão vem do termo', () => {
    const aq = termo(52, null, null).data_aquisicao;
    expect([aq.valor, aq.encontrado, aq.fonte.tipo]).toEqual(['D', '2026-08-20', 'documento']);
  });

  test('nº do documento em outra página do termo confere', () => {
    const linha = registroTermo(53, '2029-01-21');
    linha.base_numero_documento = '88990011';
    const paginas = [...paginasTermo(), pagina('termo.pdf', 3, 'anexo b - relacao de contratos: 88990011 maria aparecida')];
    const status = pre([linha], paginas).resultados[0].campos.numero_documento;
    expect(status.valor).toBe('V');
    expect(status.fonte.pagina).toBe(3);
  });
});

describe('documento de outro sacado', () => {
  const OUTRA = 'CEDULA DE CREDITO BANCARIO Nº 7777123\r\nEMITENTE: CARLOS EDUARDO SOUZA CPF 987.654.321-00\r\n'
    + 'VALOR DA PARCELA R$ 345,67 VENCIMENTO 10/10/2026\r\n';
  const rodar = (texto: string) => {
    const reg = registro(1, 'ccb', {
      numero_documento: "'4321987", sacado_nome: 'JOANA MARIA PEREIRA', sacado_documento: '123.456.789-09',
      valor_total: '345.67', data_vencimento: '2026-10-10',
    });
    return naoEncontradoViraD(pre([reg], [pagina('ccb.pdf', 1, texto)])).resultados[0];
  };

  test('CCB sem nada do título não é sugerida', () => {
    const res = rodar(OUTRA);
    expect(res.candidatos).not.toHaveProperty('lastro');
    expect(res.campos.valor_total.valor).not.toBe('V');
  });

  test('a mesma CCB com o CPF do título continua', () => {
    const res = rodar(OUTRA.replace('987.654.321-00', '123.456.789-09'));
    expect(res.candidatos.lastro.processed_pdf).toBe('ccb.pdf');
    expect(res.candidatos.lastro.aviso).toBeNull();
  });

  test('termo certo e CCB só com a pessoa seguem sugeridos', () => {
    const dossie = 'CONSULTA CADASTRAL\r\nNOME: MARIA ALVES COSTA CPF 111.444.777-35\r\nSCORE 712 SITUACAO REGULAR\r\n';
    const regs = ['ccb', 'termo_cessao'].map((tipo) => registro(5, tipo, {
      numero_documento: "'3C4D-40002", valor_total: '1500', sacado_documento: '111.444.777-35', sacado_nome: 'MARIA ALVES COSTA',
      nome_fundo: 'FUNDO ALFA FIDC RL', cnpj_fundo: '11.444.777/0001-61',
    }));
    const res = pre(regs, [pagina('termo.pdf', 1, TERMO_CODIGOS), pagina('dossie.pdf', 1, dossie)],
      { tiposPdf: { 'termo.pdf': true, 'dossie.pdf': false } }).resultados[0];
    expect(new Set(Object.keys(res.candidatos))).toEqual(new Set(['termo', 'lastro']));
    expect(res.candidatos.lastro.aviso).toBe('so_a_pessoa');
    expect(res.confianca).not.toBe('alta');
  });

  test('documento só com a pessoa fica com aviso', () => {
    const dossie = 'CONSULTA CADASTRAL\r\nNOME: JOANA MARIA PEREIRA CPF 123.456.789-09\r\nSCORE 712 SITUACAO REGULAR\r\n';
    const res = rodar(dossie);
    expect([res.candidatos.lastro.aviso, res.confianca]).toEqual(['so_a_pessoa', 'baixa']);
  });
});

describe('termo de outra base', () => {
  test('pendência acha o termo subido em outra base do fundo', () => {
    const externas = paginasTermo();
    const info = { 'termo.pdf': { base_id: 'outra', rotulo: 'FUNDO ALFA FIDC RL — ref. 2026-09-30' } };
    const res = pre([registroTermo(60, '2029-01-21')], [pagina('ccb.pdf', 1, CCB)], { paginasExternas: externas, pdfsExternos: info }).resultados[0];
    expect(res.candidatos.termo.processed_pdf).toBe('termo.pdf');
    expect(res.candidatos.termo.base_externa).toEqual(info['termo.pdf']);
    expect(res.campos.data_aquisicao.valor).toBe('V');
  });

  test('PDF de outra base nunca vira candidato de lastro', () => {
    const r = pre([registro(61, 'lastro', { valor_total: '111.47', sacado_documento: '111.222.333-96' })], [],
      { paginasExternas: [pagina('outra_ccb.pdf', 1, CCB)], pdfsExternos: { 'outra_ccb.pdf': { base_id: 'x', rotulo: 'x' } } });
    expect(r.resultados[0].candidatos).toEqual({});
  });

  test('CCB de outra base marcada como lastro vira candidato', () => {
    const info = { 'outra_ccb.pdf': { base_id: 'x', rotulo: 'FUNDO ALFA — ref. 2026-09-30', tipo: 'lastro' } };
    const r = pre([registro(62, 'lastro', { valor_total: '111.47', sacado_documento: '111.222.333-96' })], [],
      { paginasExternas: [pagina('outra_ccb.pdf', 1, CCB)], pdfsExternos: info });
    const lastro = r.resultados[0].candidatos.lastro;
    expect([lastro.processed_pdf, lastro.base_externa]).toEqual(['outra_ccb.pdf', info['outra_ccb.pdf']]);
  });
});

describe('tabela de parcelas', () => {
  const CCB_T = 'CEDULA DE CREDITO BANCARIO Nº 4321987\r\nEMITENTE: JOANA MARIA PEREIRA CPF 123.456.789-09\r\n'
    + 'DATA DE EMISSAO: 10/01/2026\r\nVENCIMENTO FINAL: 25/12/2026\r\n';
  const TABELA = '001 25/01/2026 R$345,67 002 25/02/2026 R$345,67 003 25/03/2026 R$345,67 004 25/04/2026 R$345,67\r\n';
  test('vencimento na tabela confere', () => {
    const pgs = [pagina('ccb.pdf', 1, CCB_T), pagina('ccb.pdf', 5, TABELA)];
    expect(parcelaNaTabela(pgs, '2026-03-25')![0]).toBe(5);
    expect(parcelaNaTabela(pgs, '2026-05-25')).toBeNull();
    expect(parcelaNaTabela([pagina('x.pdf', 1, '001 25/03/2026 R$1,00 002 25/04/2026 R$1,00')], '2026-03-25')).toBeNull();
  });
});

describe('cessionário de outro fundo', () => {
  const rodar = (termo: string) => pre([registro(1, 'termo_cessao', {
    numero_documento: "'52635-01", valor_total: '1613.33', data_vencimento: '2026-09-05',
    sacado_documento: '33.444.555/0002-07', cedente_documento: '11.222.333/0001-81',
    nome_fundo: 'FUNDO ALFA FIDC', cnpj_fundo: '11.444.777/0001-61',
  })], [pagina('termo.pdf', 1, termo)], { tiposPdf: { 'termo.pdf': true } }).resultados[0].campos;

  test('termo que cede pra outro CNPJ diz qual', () => {
    const doc = rodar('TERMO DE CESSAO DE DIREITOS CREDITORIOS\r\nCEDENTE: PAPELARIA MODELO LTDA CNPJ 11.222.333/0001-81\r\n'
      + 'CESSIONARIA: OUTRO FUNDO FIDC, CNPJ 32.800.738/0001-20\r\n'
      + '52635-01 EXEMPLO ACADEMIA DE GINASTICA LTDA 33.444.555/0002-07 R$ 1.613,33 05/09/2026\r\n').doc_cessionario;
    expect([doc.valor, doc.encontrado, doc.regra]).toEqual(['D', '32.800.738/0001-20', 'cessionario_outro_cnpj']);
  });

  test('com o nome do fundo o outro CNPJ não é outro fundo', () => {
    const campos = rodar('TERMO DE CESSAO DE DIREITOS CREDITORIOS\r\nCEDENTE: PAPELARIA MODELO LTDA CNPJ 11.222.333/0001-81\r\n'
      + 'CESSIONARIO: ALFA FUNDO DE INVESTIMENTO EM DIREITOS CREDITORIOS, inscrito no CNPJ sob o\r\n'
      + 'nº 32.800.738/0001-20\r\n'
      + '52635-01 EXEMPLO ACADEMIA DE GINASTICA LTDA 33.444.555/0002-07 R$ 1.613,33 05/09/2026\r\n');
    expect(campos.nome_cessionario.valor).toBe('V');
    expect(campos.doc_cessionario.regra).not.toBe('cessionario_outro_cnpj');
    expect(campos.doc_cessionario.valor).not.toBe('D');
  });
});

describe('listagem não é lastro', () => {
  const LINHAS = [
    ['8638376301', '250,76', 'andre domingos goncalves'], ['8638413002', '311,20', 'andre luiz de melo'],
    ['8638455103', '198,45', 'beatriz souza ramos'], ['8638490204', '402,10', 'carlos henrique prado'],
    ['8638522305', '275,00', 'daniela costa freitas'], ['8638567406', '189,90', 'eduardo lima barros'],
    ['8638601507', '333,33', 'fernanda alves rocha'], ['8638645608', '260,15', 'gustavo pires nunes'],
  ];
  const RELATORIO = 'relatorio de arquivos validados pagina 1 de 37\r\n15/08/2026 10:42:13\r\n'
    + 'nome do arquivo: remessa_20260815.rem\r\n'
    + 'nº documento parcela vencimento valor aquisicao valor aquisicao sacado\r\n'
    + LINHAS.map(([n, v, nome]) => `${n} 01 10/07/2029 r$ ${v} 15/08/2026 r$ ${v} ${nome}\r\n`).join('');
  const CCB_L = 'CEDULA DE CREDITO BANCARIO Nº 8638376301\r\nEMITENTE: ANDRE DOMINGOS GONCALVES CPF 123.456.789-09\r\n'
    + 'DATA DE EMISSAO: 15/08/2026\r\nVALOR DA PARCELA R$ 250,76 VENCIMENTO FINAL: 10/07/2029\r\n';
  const FLUXO = [1, 2, 3, 4, 5, 6, 7].map((m, i) => `${String(i + 1).padStart(3, '0')} 10/${String(m).padStart(2, '0')}/2029 r$ 250,76\r\n`).join('');
  const rodar = (paginas: any[]) => pre([registro(1, 'ccb', {
    numero_documento: '8638376301', sacado_nome: 'ANDRE DOMINGOS GONCALVES', sacado_documento: '123.456.789-09',
    valor_total: '250.76', data_vencimento: '2029-07-10',
  })], paginas).resultados[0];

  test('relatório com vários devedores não vira lastro', () => {
    const res = rodar([pagina('relatorio.pdf', 1, RELATORIO)]);
    expect(res.candidatos).not.toHaveProperty('lastro');
    expect(res.confianca).toBe('sem_candidato');
  });

  test('com a CCB na base a sugestão é a CCB', () => {
    const lastro = rodar([pagina('relatorio.pdf', 1, RELATORIO), pagina('ccb.pdf', 1, CCB_L)]).candidatos.lastro;
    expect(lastro.processed_pdf).toBe('ccb.pdf');
    expect(lastro.alternativas.map((a: any) => a.processed_pdf)).not.toContain('relatorio.pdf');
  });

  test('fluxo de pagamentos de um devedor continua lastro', () => {
    expect(rodar([pagina('ccb.pdf', 1, CCB_L + FLUXO)]).candidatos.lastro.processed_pdf).toBe('ccb.pdf');
  });
});
