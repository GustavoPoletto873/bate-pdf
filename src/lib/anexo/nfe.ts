import type { NovaLeitura } from '@/lib/leituras';
import { lerMoeda } from '@/lib/valores';
import { acharDescendente, acharFilho, contem, lerXml, todosDescendentes, type NoXml } from './xml';

/**
 * XML de NF-e enviado no Anexo, lido aqui mesmo, sem IA nem SERPRO
 * (modules/nota_fiscal_eletronica._processar_xml_nfe do Bate Lastro): uma leitura por
 * duplicata (cobr/dup), NU_DOCUMENTO = "<nNF>-<nDup>", TIPO_RECEBIVEL 'NOTA FISCAL ELETRONICA'.
 */

export const TIPO_RECEBIVEL_NFE = 'NOTA FISCAL ELETRONICA';

export class NfeInvalida extends Error {}

export type ResultadoXml =
  | { tipo: 'nfe_xml'; chave_nfe: string; status_nfe: 'Ativa' | 'Cancelada'; numero_nota: string; registros: Record<string, unknown>[] }
  | { tipo: 'outro_xml' };

const textoDe = (no: NoXml | null) => (no ? no.texto.trim() : null);

function formatarDoc(doc: string | null): string {
  const d = (doc ?? '').replace(/\D/g, '');
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return d;
}

/** Data do XML sem o fuso, sem mudar o dia ("2024-03-15T10:00:00-03:00" → 2024-03-15). */
function dataDoXml(t: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t ?? '');
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

export function lerXmlDocumento(conteudo: string): ResultadoXml {
  const raiz = lerXml(conteudo);
  if (!contem(raiz, 'infNFe')) return { tipo: 'outro_xml' };

  let chave = textoDe(acharDescendente(raiz, 'chNFe'));
  if (!chave) {
    const inf = raiz.nome === 'infNFe' ? raiz : acharDescendente(raiz, 'infNFe');
    const id = inf?.atributos.Id ?? '';
    chave = id.startsWith('NFe') ? id.slice(3) : id;
  }
  if (!chave || chave.length < 44) throw new NfeInvalida(`Chave NF-e inválida: '${chave ?? ''}'`);

  const cstat = textoDe(acharDescendente(raiz, 'cStat'));
  const status = cstat && ['101', '151', '110'].includes(cstat) ? 'Cancelada' : 'Ativa';
  const numero = textoDe(acharDescendente(raiz, 'nNF')) ?? '';

  const emit = acharDescendente(raiz, 'emit');
  const dest = acharDescendente(raiz, 'dest');
  if (!emit || !dest) throw new NfeInvalida('Emitente ou destinatário não encontrado no XML');
  const nomeCedente = textoDe(acharFilho(emit, 'xNome'));
  const nomeSacado = textoDe(acharFilho(dest, 'xNome'));
  if (nomeCedente === null || nomeSacado === null) throw new NfeInvalida('Dados de emitente ou destinatário incompletos');
  const docCedente = formatarDoc(textoDe(acharFilho(emit, 'CNPJ') ?? acharFilho(emit, 'CPF')));
  const docSacado = formatarDoc(textoDe(acharFilho(dest, 'CNPJ') ?? acharFilho(dest, 'CPF')));
  const emissao = dataDoXml(textoDe(acharDescendente(raiz, 'dhEmi')));

  const dups = todosDescendentes(raiz, 'dup');
  if (!dups.length) throw new NfeInvalida('Nenhuma duplicata (cobr/dup) encontrada no XML');

  const registros = dups.map((dup) => {
    const nDup = textoDe(acharFilho(dup, 'nDup'));
    const vDup = textoDe(acharFilho(dup, 'vDup'));
    const n = nDup !== null && /^\s*[+-]?\d+\s*$/.test(nDup) ? Number(nDup) : 0;
    return {
      NU_DOCUMENTO: nDup !== null ? `${numero}-${nDup}` : numero,
      DATA_VENCIMENTO_ORIGINAL: dataDoXml(textoDe(acharFilho(dup, 'dVenc'))),
      VALOR_NOMINAL: vDup !== null && Number.isFinite(Number(vDup)) ? Number(vDup) : 0,
      NOME_CEDENTE: nomeCedente,
      DOC_CEDENTE: docCedente,
      NOME_SACADO: nomeSacado,
      DOC_SACADO: docSacado,
      DATA_EMISSAO: emissao,
      NUMERO_PARCELA: n,
      QUANTIDADE_PARCELAS: dups.length,
      CHAVE_NFE: chave,
      STATUS_NFE: status,
    };
  });
  return { tipo: 'nfe_xml', chave_nfe: chave, status_nfe: status, numero_nota: numero, registros };
}

/** Registros da NF-e → linhas de `leituras`. */
export function leiturasDaNfe(registros: Record<string, unknown>[], contexto: { operacaoId: string | null; documentoId: number | null }): NovaLeitura[] {
  return registros.map((r) => ({
    origem: 'ia',
    tipo_documento: 'nfe_xml',
    tipo_recebivel: TIPO_RECEBIVEL_NFE,
    operacao_id: contexto.operacaoId,
    documento_id: contexto.documentoId,
    pdf_id: null,
    numero_documento: r.NU_DOCUMENTO as string,
    data_vencimento: r.DATA_VENCIMENTO_ORIGINAL as string | null,
    valor_nominal: lerMoeda(r.VALOR_NOMINAL),
    cedente_nome: r.NOME_CEDENTE as string,
    cedente_documento: r.DOC_CEDENTE as string,
    sacado_nome: r.NOME_SACADO as string,
    sacado_documento: r.DOC_SACADO as string,
    data_emissao: r.DATA_EMISSAO as string | null,
    numero_parcela: r.NUMERO_PARCELA as number,
    quantidade_parcelas: r.QUANTIDADE_PARCELAS as number,
    dados: { ...r, TIPO_RECEBIVEL: TIPO_RECEBIVEL_NFE, OPERACAO_ID: contexto.operacaoId },
  }));
}
