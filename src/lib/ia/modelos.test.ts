import { describe, expect, test } from 'vitest';
import { dataBrasileiraComTroca, dataBrOuIso, lerValorMonetario, valorPositivo } from './conversao';
import { esquemaJson, validarModelo } from './esquema';
import { CCB, DUPLICATA, LEITORES, MODELO_CLASSIFICACAO, PROMPT_CLASSIFICACAO, TERMO_CESSAO, tipoClassificado } from './modelos';
import { registrosDaLeitura, leituraDoRegistro } from './linhas';
import { normalizarLeitura } from '@/lib/leituras';

describe('conversões portadas dos validadores Pydantic', () => {
  test('parse_currency', () => {
    expect(lerValorMonetario('1.234,56')).toBe(1234.56);
    expect(lerValorMonetario('R$ 789,64')).toBe(789.64);
    expect(lerValorMonetario('1,234.56')).toBe(1234.56);
    expect(lerValorMonetario('1.000')).toBe(1000);
    expect(lerValorMonetario('1,000')).toBe(1000);
    expect(lerValorMonetario('115.56')).toBe(115.56);
    expect(lerValorMonetario('abc')).toBe(0);
    expect(lerValorMonetario(12.5)).toBe(12.5);
    expect(() => valorPositivo('0,00', 'Valor nominal')).toThrow('Valor nominal deve ser maior que zero');
  });

  test('datas DD/MM/AAAA e ISO, com correção de ano do OCR', () => {
    expect(dataBrOuIso('15/03/2024')).toBe('2024-03-15');
    expect(dataBrOuIso('15/03/24')).toBe('2024-03-15');
    expect(dataBrOuIso('2024-03-15')).toBe('2024-03-15');
    expect(dataBrOuIso('1225-03-15')).toBe('2025-03-15');
    expect(() => dataBrOuIso('31/02/2024')).toThrow("Data inválida '31/02/2024'");
    expect(dataBrOuIso(null, { aceitaNulo: true })).toBeNull();
    expect(() => dataBrOuIso(null)).toThrow('Data inválida, esperado string ou objeto date');
    expect(dataBrasileiraComTroca('12/25/2024')).toBe('2024-12-25');
    expect(() => dataBrasileiraComTroca('31/02/2024')).toThrow('Data inválida');
  });
});

describe('modelos e schemas', () => {
  test('schema da classificação: nativos, adicionais e fallbacks por último', () => {
    const nomes = MODELO_CLASSIFICACAO.campos.map((c) => c.nome);
    expect(nomes.slice(0, 3)).toEqual(['duplicata', 'ccb', 'termo_cessao']);
    expect(nomes.slice(-2)).toEqual(['outro_documento', 'intervencao_humana']);
    expect(nomes).toContain('cnh');
    expect(PROMPT_CLASSIFICACAO).toContain('CNH deve usar cnh=true');
    expect(tipoClassificado({ duplicata: false, ccb: true, outro_documento: true })).toBe('ccb');
    expect(tipoClassificado({})).toBe('outro_documento');
  });

  test('schema do termo usa os aliases e as descrições do Bate Lastro', () => {
    const s = esquemaJson(TERMO_CESSAO) as { properties: Record<string, { description?: string; items?: { properties: Record<string, unknown> } }>; required: string[] };
    expect(Object.keys(s.properties)).toEqual(['NOME_CESSIONARIO', 'DOC_CESSIONARIO', 'NOME_CEDENTE', 'DOC_CEDENTE', 'relacaoParcelas']);
    expect(s.properties.NOME_CESSIONARIO.description).toBe('Nome do cessionário do termo de cessão.\nQuem está comprando os direitos creditórios.');
    expect(Object.keys(s.properties.relacaoParcelas.items!.properties)).toContain('DATA_AQUISICAO');
    expect(s.required).toContain('DOC_CEDENTE');
    expect(Object.keys(LEITORES).sort()).toEqual(['ccb', 'confissao_divida', 'cpr', 'duplicata', 'nota_comercial', 'nota_fiscal_servicos', 'nota_promissoria', 'termo_cessao']);
  });

  test('CCB: sequência de parcelas e datas da primeira/última conferidas', () => {
    const ccb = {
      NU_DOCUMENTO: '123', NOME_CEDENTE: 'BANCO FICTICIO SA', DOC_CEDENTE: '11.222.333/0001-81', NOME_SACADO: 'JOAO DA SILVA',
      DOC_SACADO: '123.456.789-09', DATA_EMISSAO: '01/08/2026', DATA_VENCIMENTO_PRIMEIRA_PARCELA: '2026-09-10', DATA_VENCIMENTO_ULTIMA_PARCELA: '2026-10-10',
      relacaoParcelas: [
        { QUANTIDADE_PARCELAS: 2, NUMERO_PARCELA: 1, VALOR_NOMINAL: '1.613,33', DATA_VENCIMENTO_ORIGINAL: '10/09/2026' },
        { QUANTIDADE_PARCELAS: 2, NUMERO_PARCELA: 2, VALOR_NOMINAL: 1613.33, DATA_VENCIMENTO_ORIGINAL: '2026-10-10' },
      ],
    };
    const ok = validarModelo(CCB, ccb);
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.valor.ENTE_CONSIGNANTE).toBeNull();
      expect((ok.valor.relacaoParcelas as Record<string, unknown>[])[0].VALOR_NOMINAL).toBe(1613.33);
      const regs = registrosDaLeitura(ok.valor);
      expect(regs).toHaveLength(2);
      expect(regs[1].NOME_SACADO).toBe('JOAO DA SILVA');
      expect('DATA_VENCIMENTO_PRIMEIRA_PARCELA' in regs[0]).toBe(false);
      const linha = normalizarLeitura(leituraDoRegistro(regs[0], { tipoDocumento: 'ccb', tipoRecebivel: 'ccb', operacaoId: 'op', pdfId: 1, documentoId: 2 }));
      expect(linha).toMatchObject({ numero_documento: '123', valor_nominal: '1613.33', data_vencimento: '2026-09-10', data_emissao: '2026-08-01', numero_parcela: 1, quantidade_parcelas: 2, tipo_recebivel: 'ccb', origem: 'ia' });
    }
    const ruim = validarModelo(CCB, { ...ccb, DOC_SACADO: '12345678909', relacaoParcelas: [ccb.relacaoParcelas[0]] });
    expect(ruim.ok).toBe(false);
    if (!ruim.ok) expect(ruim.erros.join(';')).toContain("Campo 'DOC_SACADO': Value error, CPF/CNPJ deve estar formatado");
    const seq = validarModelo(CCB, { ...ccb, relacaoParcelas: [ccb.relacaoParcelas[0]] });
    expect(seq.ok).toBe(false);
    if (!seq.ok) expect(seq.erros[0]).toContain('sequência de 1 até 2');
  });

  test('duplicata: campo faltando e valor zerado viram erros que voltam ao Gemini', () => {
    const r = validarModelo(DUPLICATA, { NOME_CEDENTE: 'X', DOC_CEDENTE: '1.2', NOME_SACADO: 'Y', DOC_SACADO: '3.4', DATA_EMISSAO: '01/01/2026', DATA_VENCIMENTO_ORIGINAL: '01/02/2026', VALOR_NOMINAL: 0 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.erros).toContain("Campo 'NU_DOCUMENTO': Field required");
      expect(r.erros).toContain("Campo 'VALOR_NOMINAL': Value error, Valor nominal deve ser maior que zero");
    }
  });

  test('termo: uma linha por título, cessionário repetido', () => {
    const r = validarModelo(TERMO_CESSAO, {
      NOME_CESSIONARIO: 'FIDC EXEMPLO', DOC_CESSIONARIO: '12.345.678/0001-95', NOME_CEDENTE: 'EMPRESA FICTICIA LTDA', DOC_CEDENTE: null,
      relacaoParcelas: [
        { NU_DOCUMENTO: 'A1', NOME_SACADO: null, DOC_SACADO: null, VALOR_NOMINAL: '100,00', DATA_AQUISICAO: '15/09/2026', DATA_VENCIMENTO_ORIGINAL: null },
        { NU_DOCUMENTO: 'A2', NOME_SACADO: 'MARIA', DOC_SACADO: '987.654.321-00', VALOR_NOMINAL: '200,00', DATA_AQUISICAO: '2026-09-15', DATA_VENCIMENTO_ORIGINAL: '2026-12-01' },
      ],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      const regs = registrosDaLeitura(r.valor);
      expect(regs.map((x) => x.NOME_CESSIONARIO)).toEqual(['FIDC EXEMPLO', 'FIDC EXEMPLO']);
      expect(regs[0].DATA_AQUISICAO).toBe('2026-09-15');
    }
    const semAquisicao = validarModelo(TERMO_CESSAO, {
      NOME_CESSIONARIO: 'F', DOC_CESSIONARIO: null, NOME_CEDENTE: 'C', DOC_CEDENTE: null,
      relacaoParcelas: [{ NU_DOCUMENTO: 'A1', NOME_SACADO: null, DOC_SACADO: null, VALOR_NOMINAL: 1, DATA_AQUISICAO: null, DATA_VENCIMENTO_ORIGINAL: null }],
    });
    expect(semAquisicao.ok).toBe(false);
  });
});
