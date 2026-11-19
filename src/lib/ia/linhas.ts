import type { NovaLeitura } from '@/lib/leituras';

/**
 * Da leitura validada às linhas de `leituras`, como utils/json_to_dataframe.py e
 * leitura_documento._persistir_resultado_leitura do Bate Lastro: uma linha por item de
 * `relacaoParcelas` (título ou parcela), com os campos do documento repetidos em todas; sem
 * `relacaoParcelas`, uma linha só. DATA_VENCIMENTO_PRIMEIRA/ULTIMA_PARCELA saem.
 */

export type RegistroLeitura = Record<string, unknown>;

export function registrosDaLeitura(dados: Record<string, unknown>): RegistroLeitura[] {
  let linhas: RegistroLeitura[];
  const detalhe = dados.relacaoParcelas;
  if (Array.isArray(detalhe)) {
    linhas = detalhe.map((item) => ({ ...(item as RegistroLeitura) }));
    for (const [chave, valor] of Object.entries(dados)) {
      if (chave === 'relacaoParcelas') continue;
      const v = Array.isArray(valor) ? (valor[0] ?? null) : valor;
      for (const l of linhas) l[chave] = v;
    }
  } else {
    linhas = [{ ...dados }];
  }
  for (const l of linhas) {
    delete l.DATA_VENCIMENTO_PRIMEIRA_PARCELA;
    delete l.DATA_VENCIMENTO_ULTIMA_PARCELA;
  }
  return linhas;
}

/** Coluna do registroLeitura do Bate Lastro → coluna de `leituras`. */
export const COLUNA_DO_REGISTRO: Record<string, keyof NovaLeitura> = {
  NU_DOCUMENTO: 'numero_documento',
  NOME_SACADO: 'sacado_nome',
  DOC_SACADO: 'sacado_documento',
  NOME_CEDENTE: 'cedente_nome',
  DOC_CEDENTE: 'cedente_documento',
  NOME_CESSIONARIO: 'cessionario_nome',
  DOC_CESSIONARIO: 'cessionario_documento',
  VALOR_NOMINAL: 'valor_nominal',
  DATA_AQUISICAO: 'data_aquisicao',
  DATA_EMISSAO: 'data_emissao',
  DATA_VENCIMENTO_ORIGINAL: 'data_vencimento',
  NUMERO_PARCELA: 'numero_parcela',
  QUANTIDADE_PARCELAS: 'quantidade_parcelas',
  ENTE_CONSIGNANTE: 'ente_consignante',
};

/** Um registro (chaves do Bate Lastro) → linha de `leituras`. `dados` guarda o registro inteiro. */
export function leituraDoRegistro(
  r: RegistroLeitura,
  contexto: { tipoDocumento: string; tipoRecebivel: string; operacaoId: string | null; pdfId: number | null; documentoId: number | null },
): NovaLeitura {
  const linha: Record<string, unknown> = {
    origem: 'ia',
    tipo_documento: contexto.tipoDocumento,
    tipo_recebivel: contexto.tipoRecebivel,
    operacao_id: contexto.operacaoId,
    pdf_id: contexto.pdfId,
    documento_id: contexto.documentoId,
    dados: { ...r, TIPO_RECEBIVEL: contexto.tipoRecebivel, OPERACAO_ID: contexto.operacaoId },
  };
  for (const [chave, coluna] of Object.entries(COLUNA_DO_REGISTRO)) {
    if (chave in r) linha[coluna] = r[chave] as never;
  }
  return linha as NovaLeitura;
}
