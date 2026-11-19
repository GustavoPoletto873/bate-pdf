import { chaveGemini } from './config';

/**
 * Cliente do Gemini, trocável: o app usa o @google/genai de verdade; os testes injetam um
 * falso com `definirFabricaGemini` (nenhum teste chama a API — ela é cobrada).
 *
 * Mesmo jeito do services/gemini_with_retry.py do Bate Lastro: o PDF sobe uma vez pela
 * Files API e cada tentativa chama generate_content com [prompt, arquivo] e o schema da
 * resposta (responseMimeType 'application/json').
 */

export type UsoChamada = { tokensEntrada: number; tokensSaida: number };

export type ArquivoEnviado = { nome: string; uri: string; mimeType: string };

export interface ClienteGemini {
  /** Sobe o PDF (Files API) e devolve a referência usada nas chamadas. */
  enviarPdf(bytes: Uint8Array, nomeExibicao: string): Promise<ArquivoEnviado>;
  /** Uma chamada ao modelo: texto da resposta (JSON) e os tokens cobrados. */
  gerarJson(p: { modelo: string; prompt: string; arquivo: ArquivoEnviado; esquema: object }): Promise<{ texto: string; uso: UsoChamada | null }>;
  /** Apaga o arquivo enviado (opcional; o Google apaga sozinho em 48 h). */
  apagar?(arquivo: ArquivoEnviado): Promise<void>;
}

export type FabricaGemini = () => Promise<ClienteGemini>;

type Global = typeof globalThis & { __batePdfFabricaGemini?: FabricaGemini | null };

/** Troca o cliente (testes). `null` volta ao Gemini de verdade. */
export function definirFabricaGemini(fabrica: FabricaGemini | null): void {
  (globalThis as Global).__batePdfFabricaGemini = fabrica;
}

/** O cliente a usar agora: o injetado, ou o Gemini com a chave do .env.local; null sem chave. */
export async function obterClienteGemini(): Promise<ClienteGemini | null> {
  const fabrica = (globalThis as Global).__batePdfFabricaGemini;
  if (fabrica) return fabrica();
  const chave = chaveGemini();
  if (!chave) return null;
  // Rede de segurança: teste nunca fala com o Google, mesmo com a chave no ambiente.
  if (process.env.VITEST) throw new Error('Teste tentou usar o Gemini de verdade: injete um cliente com definirFabricaGemini.');
  return criarClienteGemini(chave);
}

const esperar = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/** Cliente real (@google/genai). Importado sob demanda: só carrega o SDK quando há leitura. */
export async function criarClienteGemini(chave: string): Promise<ClienteGemini> {
  const { GoogleGenAI, createPartFromUri } = await import('@google/genai');
  // Sem o retry do SDK: cada tentativa é cobrada, e quem decide repetir é o gerarComRetry
  // (3 tentativas, como no Bate Lastro). Leitura longa (CCB de 60 parcelas) pode demorar.
  const ai = new GoogleGenAI({ apiKey: chave, httpOptions: { timeout: 5 * 60_000, retryOptions: { attempts: 1 } } });
  return {
    async enviarPdf(bytes, nomeExibicao) {
      const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
      let arquivo = await ai.files.upload({ file: blob, config: { mimeType: 'application/pdf', displayName: nomeExibicao } });
      for (let i = 0; String(arquivo.state) === 'PROCESSING' && i < 60 && arquivo.name; i++) {
        await esperar(1000);
        arquivo = await ai.files.get({ name: arquivo.name });
      }
      if (String(arquivo.state) === 'FAILED' || !arquivo.uri || !arquivo.name) {
        throw new Error('O Gemini não conseguiu receber o PDF enviado.');
      }
      return { nome: arquivo.name, uri: arquivo.uri, mimeType: arquivo.mimeType ?? 'application/pdf' };
    },
    async gerarJson({ modelo, prompt, arquivo, esquema }) {
      const resposta = await ai.models.generateContent({
        model: modelo,
        contents: [prompt, createPartFromUri(arquivo.uri, arquivo.mimeType)],
        config: { responseMimeType: 'application/json', responseJsonSchema: esquema },
      });
      const u = resposta.usageMetadata;
      return {
        texto: resposta.text ?? '',
        // Tokens de raciocínio ("thoughts") são cobrados como saída.
        uso: u ? { tokensEntrada: u.promptTokenCount ?? 0, tokensSaida: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0) } : null,
      };
    },
    async apagar(arquivo) {
      await ai.files.delete({ name: arquivo.nome });
    },
  };
}
