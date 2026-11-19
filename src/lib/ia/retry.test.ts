import { beforeEach, describe, expect, test } from 'vitest';
import type { ClienteGemini } from './cliente';
import { ErroGemini, FalhaGeminiComCusto, gerarComRetry, modeloDisponivel, segundosAteACota } from './retry';
import { validarModelo } from './esquema';
import { MODELO_CLASSIFICACAO } from './modelos';
import { custoUsd } from './config';

/** Cliente falso: devolve as respostas em ordem e guarda os prompts recebidos. Nunca fala com o Google. */
function clienteFalso(respostas: (string | Error)[]) {
  const prompts: string[] = [];
  let enviados = 0;
  let apagados = 0;
  const cliente: ClienteGemini = {
    async enviarPdf() { enviados++; return { nome: 'files/teste', uri: 'https://exemplo.invalid/files/teste', mimeType: 'application/pdf' }; },
    async gerarJson({ prompt }) {
      prompts.push(prompt);
      const r = respostas.shift();
      if (r === undefined) throw new Error('sem resposta');
      if (r instanceof Error) throw r;
      return { texto: r, uso: { tokensEntrada: 1000, tokensSaida: 50 } };
    },
    async apagar() { apagados++; },
  };
  return { cliente, prompts, enviados: () => enviados, apagados: () => apagados };
}

const semEspera = async () => {};
const validar = (json: unknown) => validarModelo(MODELO_CLASSIFICACAO, json);
const todosFalsos = Object.fromEntries(MODELO_CLASSIFICACAO.campos.map((c) => [c.nome, false]));
const pdf = new Uint8Array([37, 80, 68, 70]);

describe('gerarComRetry', () => {
  beforeEach(() => {
    (globalThis as { __batePdfCotaGemini?: Map<string, number> }).__batePdfCotaGemini = new Map();
  });

  test('erro de validação volta no prompt da tentativa seguinte; tokens de todas as tentativas', async () => {
    const f = clienteFalso([JSON.stringify({ ccb: true }), JSON.stringify({ ...todosFalsos, ccb: true })]);
    const r = await gerarComRetry({ cliente: f.cliente, pdf, prompt: 'P', esquema: {}, validar, modelo: 'm', esperar: semEspera });
    expect(r.valor.ccb).toBe(true);
    expect(f.prompts).toHaveLength(2);
    expect(f.prompts[1]).toContain('IMPORTANTE: Na tentativa anterior houve erro de validação: Campo \'duplicata\': Field required');
    expect(r.tentativas).toHaveLength(2);
    expect(f.enviados()).toBe(1);
    expect(f.apagados()).toBe(1);
  });

  test('JSON truncado não tenta de novo e leva o custo', async () => {
    const f = clienteFalso(['{"ccb": tr']);
    const e = await gerarComRetry({ cliente: f.cliente, pdf, prompt: 'P', esquema: {}, validar, modelo: 'm', esperar: semEspera }).catch((x) => x);
    expect(e).toBeInstanceOf(FalhaGeminiComCusto);
    expect((e as FalhaGeminiComCusto).tipo).toBe('json');
    expect((e as FalhaGeminiComCusto).tentativas).toHaveLength(1);
  });

  test('três validações ruins: falha com as três tentativas cobradas', async () => {
    const f = clienteFalso(['{}', '{}', '{}']);
    const e = await gerarComRetry({ cliente: f.cliente, pdf, prompt: 'P', esquema: {}, validar, modelo: 'm', esperar: semEspera }).catch((x) => x);
    expect((e as FalhaGeminiComCusto).tipo).toBe('validacao');
    expect((e as FalhaGeminiComCusto).tentativas).toHaveLength(3);
  });

  test('cota esgotada marca o modelo e a próxima chamada nem sobe o PDF', async () => {
    const f = clienteFalso([new Error('429 RESOURCE_EXHAUSTED {"retryDelay": "120s"}')]);
    const e = await gerarComRetry({ cliente: f.cliente, pdf, prompt: 'P', esquema: {}, validar, modelo: 'm1', esperar: semEspera }).catch((x) => x);
    expect(e).toBeInstanceOf(ErroGemini);
    expect((e as ErroGemini).tipo).toBe('cota');
    expect(modeloDisponivel('m1')).toBe(false);
    const g = clienteFalso([]);
    await expect(gerarComRetry({ cliente: g.cliente, pdf, prompt: 'P', esquema: {}, validar, modelo: 'm1', esperar: semEspera })).rejects.toThrow('Cota do Gemini esgotada');
    expect(g.enviados()).toBe(0);
    expect(segundosAteACota('please retry in 9h42m25s')).toBe(9 * 3600 + 42 * 60);
  });

  test('erro genérico tenta 3 vezes; PDF grande demais não repete', async () => {
    const f = clienteFalso([new Error('fetch failed'), new Error('fetch failed'), JSON.stringify({ ...todosFalsos, duplicata: true })]);
    const r = await gerarComRetry({ cliente: f.cliente, pdf, prompt: 'P', esquema: {}, validar, modelo: 'm', esperar: semEspera });
    expect(r.valor.duplicata).toBe(true);
    const g = clienteFalso([new Error('400 The document exceeds the supported page limit')]);
    const e = await gerarComRetry({ cliente: g.cliente, pdf, prompt: 'P', esquema: {}, validar, modelo: 'm', esperar: semEspera }).catch((x) => x);
    expect((e as ErroGemini).tipo).toBe('grande_demais');
    expect(g.prompts).toHaveLength(1);
  });

  test('tabela de preços do Bate Lastro', () => {
    expect(custoUsd('gemini-3.1-flash-lite', 1_000_000, 1_000_000)).toBeCloseTo(0.25 + 1.5);
    expect(custoUsd('modelo-desconhecido', 10, 10)).toBeNull();
  });
});
