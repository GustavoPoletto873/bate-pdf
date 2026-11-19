import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, pastaDeDados, pastaDePdfs, transacao } from '@/lib/db';
import { apagarLeiturasDoDocumento, inserirLeituras, type NovaLeitura } from '@/lib/leituras';
import type { ClienteGemini } from '@/lib/ia/cliente';
import { custoUsd, MENSAGEM_SEM_CHAVE, semSegredo } from '@/lib/ia/config';
import { classificarDocumento, lerComConfig, lerDocumento, somarTentativas } from '@/lib/ia/leitura';
import { tiposAtivos } from '@/lib/treino';
import { leituraDoRegistro } from '@/lib/ia/linhas';
import { LEITORES, TIPOS_ADICIONAIS, TIPOS_SEM_LEITURA } from '@/lib/ia/modelos';
import { ErroGemini, FalhaGeminiComCusto, type Tentativa } from '@/lib/ia/retry';
import { registrarNota } from '@/lib/notasFiscais';
import { leiturasDaNfe, lerXmlDocumento, NfeInvalida } from './nfe';
import { PdfIlegivel } from './paginas';
import { XmlInvalido } from './xml';

/**
 * A leitura de um documento do Anexo (anexo_processamento.processar_anexo +
 * main_lastro.app_lastro + processar_pdf_com_ia do Bate Lastro), "Sempre Gemini":
 * - XML: NF-e lida aqui (sem IA); outro XML só classificado;
 * - PDF: acima de 50 páginas não vai para a IA; senão o Gemini classifica e, se for um tipo
 *   financeiro, extrai — uma leitura por título/parcela em `leituras`;
 * - tipos adicionais (cnh, holerite…), garantia/registradora, outro_documento e
 *   intervencao_humana ficam só classificados, com o motivo.
 * Tokens e custo de cada etapa vão para `uso_ia`, inclusive das tentativas que falharam.
 */

export type Dependencias = {
  /** Cliente do Gemini; null = sem chave configurada. */
  cliente: () => Promise<ClienteGemini | null>;
  contarPaginas: (bytes: Uint8Array) => Promise<number>;
  modelo: string;
  maxPaginas: number;
  esperar?: (ms: number) => Promise<void>;
};

export type Situacao = 'lido' | 'somente_classificado' | 'erro';

export type ResultadoDocumento = { situacao: Situacao; tipo_documento: string | null; motivo: string | null; linhas: number; bruto?: unknown };

type Documento = {
  id: number; lote_id: string; operacao_id: string | null; pdf_id: number | null; caminho: string; extensao: string | null; arquivo: string | null;
  base_id: string; sha256: string | null;
};

const agora = () => new Date().toISOString();

/** Erro que vira o motivo do documento (mensagem para a pessoa). */
export class LeituraRecusada extends Error {
  constructor(mensagem: string, public tipoDocumento: string | null = null) {
    super(mensagem);
  }
}

export function atualizarDocumento(id: number, campos: { status: string; motivo?: string | null; tipo_documento?: string | null; paginas?: number | null }): void {
  db().prepare(`UPDATE anexo_documentos SET status = ?, motivo = ?, tipo_documento = COALESCE(?, tipo_documento),
      paginas = COALESCE(?, paginas), atualizado_em = ? WHERE id = ?`)
    .run(campos.status, campos.motivo ?? null, campos.tipo_documento ?? null, campos.paginas ?? null, agora(), id);
}

function registrarUso(doc: Documento, etapa: string, modelo: string, tentativas: Tentativa[], mensagem: string): void {
  if (!tentativas.length) return;
  const { tokensEntrada, tokensSaida } = somarTentativas(tentativas);
  db().prepare(`INSERT INTO uso_ia (base_id, documento_id, etapa, modelo, tokens_entrada, tokens_saida, custo_usd, criado_em, mensagem)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(doc.base_id, doc.id, etapa, modelo, tokensEntrada, tokensSaida, custoUsd(modelo, tokensEntrada, tokensSaida), agora(), mensagem.slice(0, 500));
}

/** Mensagem do erro para a tela: diz o que fazer, sem o erro cru. */
export function motivoDoErro(e: unknown): string {
  if (e instanceof LeituraRecusada) return e.message;
  if (e instanceof ErroGemini) {
    if (e.tipo === 'chave') return 'O Google recusou a chave do Gemini. Confira GEMINI_API_KEY no .env.local, reinicie o app e use “Tentar de novo”.';
    if (e.tipo === 'cota') return `${e.message} Use “Tentar de novo” mais tarde.`;
    if (e.tipo === 'grande_demais') return e.message;
    return 'Não foi possível enviar o PDF para o Gemini. Confira a internet e use “Tentar de novo”.';
  }
  if (e instanceof FalhaGeminiComCusto) {
    if (e.tipo === 'json') return 'A resposta do Gemini veio cortada (documento grande demais para ler de uma vez).';
    if (e.tipo === 'validacao') return `O Gemini não devolveu uma leitura válida em 3 tentativas: ${semSegredo(e.message).slice(0, 300)}`;
    const msg = e.causa.message ?? '';
    if (/fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|network|timeout|aborted/i.test(msg)) {
      return 'Sem conexão com o Gemini. Confira a internet e use “Tentar de novo”.';
    }
    return 'O Gemini falhou nas 3 tentativas. Use “Tentar de novo”; se repetir, veja o terminal do app.';
  }
  if (e instanceof PdfIlegivel || e instanceof NfeInvalida || e instanceof XmlInvalido) return e.message;
  return 'Falha inesperada na leitura. Use “Tentar de novo”; se repetir, veja o terminal do app.';
}

function carregar(documentoId: number): Documento {
  const doc = db().prepare(`SELECT d.id, d.lote_id, d.operacao_id, d.pdf_id, d.caminho, d.extensao, d.arquivo, l.base_id, p.sha256
    FROM anexo_documentos d JOIN anexo_lotes l ON l.id = d.lote_id LEFT JOIN pdfs p ON p.id = d.pdf_id
    WHERE d.id = ?`).get(documentoId) as Documento | undefined;
  if (!doc) throw new LeituraRecusada('Documento não encontrado (o lote ou a base foi excluído).');
  return doc;
}

function gravarLeituras(doc: Documento, linhas: NovaLeitura[]): void {
  transacao(() => {
    apagarLeiturasDoDocumento(doc.id);
    inserirLeituras(doc.base_id, linhas, { emTransacao: false });
  });
}

function concluir(doc: Documento, r: ResultadoDocumento): ResultadoDocumento {
  atualizarDocumento(doc.id, { status: r.situacao, motivo: r.motivo, tipo_documento: r.tipo_documento });
  return r;
}

function processarXml(doc: Documento): ResultadoDocumento {
  if (!doc.arquivo) throw new LeituraRecusada('O arquivo XML não está mais na pasta de dados. Envie de novo.');
  const conteudo = new TextDecoder('utf-8').decode(readFileSync(join(pastaDeDados(), doc.arquivo)));
  const r = lerXmlDocumento(conteudo);
  if (r.tipo === 'outro_xml') return concluir(doc, { situacao: 'somente_classificado', tipo_documento: 'outro_xml', motivo: 'XML sem extrator disponível', linhas: 0 });
  const linhas = leiturasDaNfe(r.registros, { operacaoId: doc.operacao_id, documentoId: doc.id });
  gravarLeituras(doc, linhas);
  // NF Status: a situação que o protocolo do XML traz (a consulta no SERPRO pode atualizar depois).
  registrarNota({ chave_nfe: r.chave_nfe, base_id: doc.base_id, status_nfe: r.status_nfe, origem: 'xml_anexo', xml_content: conteudo });
  return concluir(doc, { situacao: 'lido', tipo_documento: 'nfe_xml', motivo: null, linhas: linhas.length, bruto: { chave_nfe: r.chave_nfe, status_nfe: r.status_nfe } });
}

async function processarPdf(doc: Documento, deps: Dependencias): Promise<ResultadoDocumento> {
  if (!doc.pdf_id || !doc.sha256) throw new LeituraRecusada('O PDF não está mais na base. Envie de novo.');
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(readFileSync(join(pastaDePdfs(doc.base_id), `${doc.sha256}.pdf`)));
  } catch {
    throw new LeituraRecusada('O arquivo do PDF não está mais na pasta de dados. Envie de novo.');
  }
  const paginas = await deps.contarPaginas(bytes);
  atualizarDocumento(doc.id, { status: 'classificando', paginas });
  if (paginas > deps.maxPaginas) {
    throw new LeituraRecusada(`PDF com ${paginas} páginas excede o limite de ${deps.maxPaginas} para envio à IA. Separe o documento em partes menores.`);
  }
  const cliente = await deps.cliente();
  if (!cliente) throw new LeituraRecusada(MENSAGEM_SEM_CHAVE);
  const opcoes = { modelo: deps.modelo, esperar: deps.esperar };

  // Tipos treinados (Gestão › Treinar IA) entram na classificação, antes dos fallbacks.
  const treinados = tiposAtivos();
  let tipo: string;
  try {
    const c = await classificarDocumento(cliente, bytes, opcoes, treinados);
    registrarUso(doc, 'classificacao', deps.modelo, c.tentativas, 'Sucesso');
    tipo = c.tipo;
  } catch (e) {
    if (e instanceof FalhaGeminiComCusto) registrarUso(doc, 'classificacao', deps.modelo, e.tentativas, `Erro após tentativas (custo cobrado): ${semSegredo(e.message)}`);
    throw e;
  }

  const treinado = treinados.find((t) => t.slug === tipo);
  if (LEITORES[tipo] || treinado) {
    atualizarDocumento(doc.id, { status: 'extraindo', tipo_documento: tipo });
    let leitura;
    try {
      leitura = treinado ? await lerComConfig(cliente, bytes, treinado, opcoes) : await lerDocumento(cliente, bytes, tipo, opcoes);
      registrarUso(doc, 'leitura', deps.modelo, leitura.tentativas, leitura.registros.length ? 'Sucesso' : 'Nenhum dado extraído');
    } catch (e) {
      if (e instanceof FalhaGeminiComCusto) registrarUso(doc, 'leitura', deps.modelo, e.tentativas, `Erro após tentativas (custo cobrado): ${semSegredo(e.message)}`);
      // O tipo já é conhecido: o documento com erro mostra o que ele é.
      if (e && typeof e === 'object') (e as { tipoDocumento?: string }).tipoDocumento = tipo;
      throw e;
    }
    if (!leitura.registros.length) throw new LeituraRecusada('Nenhum dado extraído do lastro/termo', tipo);
    const linhas = leitura.registros.map((r) => leituraDoRegistro(r, {
      tipoDocumento: tipo, tipoRecebivel: tipo, operacaoId: doc.operacao_id, pdfId: doc.pdf_id, documentoId: doc.id,
    }));
    gravarLeituras(doc, linhas);
    return concluir(doc, { situacao: 'lido', tipo_documento: tipo, motivo: null, linhas: linhas.length, bruto: leitura.dados });
  }
  if (TIPOS_ADICIONAIS.has(tipo)) {
    return concluir(doc, { situacao: 'somente_classificado', tipo_documento: tipo, motivo: 'Extração adicional não disponível na versão local', linhas: 0 });
  }
  if (TIPOS_SEM_LEITURA.has(tipo)) {
    return concluir(doc, { situacao: 'somente_classificado', tipo_documento: tipo, motivo: 'Tipo classificado sem leitura por IA', linhas: 0 });
  }
  return concluir(doc, { situacao: 'somente_classificado', tipo_documento: tipo, motivo: 'Tipo sem extração automática', linhas: 0 });
}

/**
 * Lê um documento. Em caso de falha o documento fica em 'erro' com o motivo e a exceção
 * sobe (o job fica 'failed').
 */
export async function processarDocumento(documentoId: number, deps: Dependencias): Promise<ResultadoDocumento> {
  const doc = carregar(documentoId);
  atualizarDocumento(doc.id, { status: 'classificando' });
  try {
    return (doc.extensao ?? '').toLowerCase() === '.xml' ? processarXml(doc) : await processarPdf(doc, deps);
  } catch (e) {
    const tipo = (e as { tipoDocumento?: string | null }).tipoDocumento ?? null;
    atualizarDocumento(doc.id, { status: 'erro', motivo: motivoDoErro(e), tipo_documento: tipo });
    throw e;
  }
}
