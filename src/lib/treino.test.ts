import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ClienteGemini } from '@/lib/ia/cliente';

// Banco temporário; o Gemini é sempre um cliente falso; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-treino-'));
let treino: typeof import('./treino');
let pers: typeof import('./ia/personalizados');
let esquema: typeof import('./ia/esquema');
let leitura: typeof import('./ia/leitura');

beforeAll(async () => {
  treino = await import('./treino');
  pers = await import('./ia/personalizados');
  esquema = await import('./ia/esquema');
  leitura = await import('./ia/leitura');
});

const PDF = new TextEncoder().encode('%PDF-1.4 mutuo rural ficticio');

const configMutuo = () => ({
  slug: 'lastro_mutuo_rural',
  nome_exibicao: 'Contrato de Mútuo Rural',
  descricao_identificacao: 'Contrato com o título CONTRATO DE MÚTUO RURAL e quadro de parcelas.',
  campos: {
    NU_DOCUMENTO: { presente: true, obrigatorio: true, instrucao: 'Número no topo' },
    NOME_SACADO: { presente: true, obrigatorio: false },
    VALOR_NOMINAL: { presente: true },
    DATA_VENCIMENTO_ORIGINAL: { presente: true },
    DATA_EMISSAO: { presente: false },
  },
  multi_recebiveis: true,
  instrucao_parcelas: 'Quadro "Cronograma"',
});

/** Cliente falso que devolve sempre a mesma extração e guarda o esquema/prompt pedidos. */
function clienteFalso(resposta: unknown, pedidos: { prompt: string; esquema: object }[] = []): ClienteGemini {
  return {
    async enviarPdf() { return { nome: 'files/x', uri: 'https://exemplo.invalid/x', mimeType: 'application/pdf' }; },
    async gerarJson({ prompt, esquema: e }) {
      pedidos.push({ prompt, esquema: e });
      return { texto: JSON.stringify(resposta), uso: { tokensEntrada: 1000, tokensSaida: 50 } };
    },
  };
}

describe('configuração do tipo treinado', () => {
  test('valida como o Bate Lastro', () => {
    expect(() => pers.validarConfig({ ...configMutuo(), slug: 'ccb' })).toThrow(/tipo nativo/);
    expect(() => pers.validarConfig({ ...configMutuo(), slug: 'lastro_' })).toThrow(/identificador/);
    expect(() => pers.validarConfig({ ...configMutuo(), campos: { NU_DOCUMENTO: { presente: false } } })).toThrow(/Pelo menos um campo/);
    expect(() => pers.validarConfig({ ...configMutuo(), campos: { NU_DOCUMENTO: { presente: true } } })).toThrow(/Valor Nominal e Data de Vencimento/);
    expect(() => pers.validarConfig({ ...configMutuo(), campos: { XPTO: { presente: true } } })).toThrow(/desconhecidos/);
    const termo = { ...configMutuo(), slug: 'termo_cessao_rural', campos: { NU_DOCUMENTO: { presente: true } } };
    expect(() => pers.validarConfig(termo)).toThrow(/repetir a cada linha/);
  });

  test('modelo de extração: parcelas em relacaoParcelas, com número e quantidade', () => {
    const cfg = pers.validarConfig(configMutuo());
    const m = pers.construirModeloExtracao(cfg);
    expect(m.campos.map((c) => c.nome)).toEqual(['NU_DOCUMENTO', 'NOME_SACADO', 'relacaoParcelas']);
    const parcela = m.campos[2].itens!;
    expect(parcela.campos.map((c) => c.nome).sort()).toEqual(['DATA_VENCIMENTO_ORIGINAL', 'NUMERO_PARCELA', 'QUANTIDADE_PARCELAS', 'VALOR_NOMINAL']);
    const json = esquema.esquemaJson(m) as { required: string[] };
    expect(json.required).toEqual(['NU_DOCUMENTO', 'relacaoParcelas']);
    // Valor em formato brasileiro e data BR viram número e ISO na validação.
    const ok = esquema.validarModelo(m, { NU_DOCUMENTO: 'MR-1', NOME_SACADO: null, relacaoParcelas: [{ VALOR_NOMINAL: '1.234,56', DATA_VENCIMENTO_ORIGINAL: '10/10/2026', NUMERO_PARCELA: 1, QUANTIDADE_PARCELAS: 1 }] });
    expect(ok).toMatchObject({ ok: true, valor: { relacaoParcelas: [{ VALOR_NOMINAL: 1234.56, DATA_VENCIMENTO_ORIGINAL: '2026-10-10' }] } });
    expect(pers.construirPromptExtracao(cfg)).toMatch(/NUMERO_PARCELA sequencial de 1 até QUANTIDADE_PARCELAS/);
  });

  test('classificação: o tipo treinado entra antes dos fallbacks', async () => {
    const cfg = pers.validarConfig(configMutuo());
    const { modelo } = pers.classificacaoCom([cfg]);
    const nomes = modelo.campos.map((c) => c.nome);
    expect(nomes.indexOf('lastro_mutuo_rural')).toBeLessThan(nomes.indexOf('outro_documento'));
    const resposta = Object.fromEntries(nomes.map((n) => [n, n === 'lastro_mutuo_rural' || n === 'outro_documento']));
    const r = await leitura.classificarDocumento(clienteFalso(resposta), PDF, { modelo: 'gemini-3.1-flash-lite', esperar: async () => {} }, [cfg]);
    expect(r.tipo).toBe('lastro_mutuo_rural');
  });
});

describe('testar → salvar', () => {
  test('salvar exige teste da mesma configuração; editar exige a versão certa', async () => {
    const cfg = configMutuo();
    expect(() => treino.criarTipo(cfg, PDF)).toThrow(/teste de extração/);

    const extracao = { NU_DOCUMENTO: 'MR-1', NOME_SACADO: 'JOAO DA SILVA', relacaoParcelas: [
      { VALOR_NOMINAL: 100, DATA_VENCIMENTO_ORIGINAL: '2026-10-10', NUMERO_PARCELA: 1, QUANTIDADE_PARCELAS: 2 },
      { VALOR_NOMINAL: 100, DATA_VENCIMENTO_ORIGINAL: '2026-11-10', NUMERO_PARCELA: 2, QUANTIDADE_PARCELAS: 2 },
    ] };
    const pedidos: { prompt: string; esquema: object }[] = [];
    const r = await treino.testarExtracao(PDF, cfg, { cliente: async () => clienteFalso(extracao, pedidos), modelo: 'gemini-3.1-flash-lite' });
    expect(r.total_linhas).toBe(2);
    expect(r.linhas[1]).toMatchObject({ NU_DOCUMENTO: 'MR-1', NUMERO_PARCELA: 2 });
    expect(pedidos[0].prompt).toMatch(/Contrato de Mútuo Rural/);

    const tipo = treino.criarTipo(cfg, PDF);
    expect(tipo).toMatchObject({ slug: 'lastro_mutuo_rural', versao: 1, tem_amostra: true, ativo: true });
    expect(treino.tiposAtivos().map((t) => t.slug)).toEqual(['lastro_mutuo_rural']);

    // Mudou a descrição: precisa testar de novo.
    const outra = { ...cfg, descricao_identificacao: 'Outra descrição do contrato de mútuo rural.' };
    expect(() => treino.atualizarTipo(tipo.id, outra, 1)).toThrow(/teste de extração/);
    await treino.testarExtracao(PDF, outra, { cliente: async () => clienteFalso(extracao), modelo: 'gemini-3.1-flash-lite' });
    expect(() => treino.atualizarTipo(tipo.id, outra, 7)).toThrow(/alterado em outro lugar/);
    expect(treino.atualizarTipo(tipo.id, outra, 1).versao).toBe(2);

    treino.excluirTipo(tipo.id);
    expect(treino.tiposAtivos()).toEqual([]);
    expect(treino.restaurarTipo(tipo.id).ativo).toBe(true);
  });

  test('extração que não valida vira erro com o que fazer', async () => {
    const cfg = { ...configMutuo(), slug: 'lastro_outro_rural' };
    await expect(treino.testarExtracao(PDF, cfg, { cliente: async () => clienteFalso({ NU_DOCUMENTO: 'X' }), modelo: 'gemini-3.1-flash-lite' }))
      .rejects.toThrow(/Ajuste as descrições/);
  });
});
