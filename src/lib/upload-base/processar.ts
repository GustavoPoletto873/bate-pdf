import { colunasDeVencimento, mapeamentoInteligente, textoDaCelula, type TituloImportado } from '@/lib/planilha/importar';
import { lerData, lerMoeda } from '@/lib/valores';
import { CAMPO_VENCIMENTO, COLUNAS_DATA, COLUNAS_OBRIGATORIAS, COLUNAS_UPLOAD, COLUNAS_VALOR } from './colunas';
import type { ErroValidacao } from './erros';
import type { Tabela } from './planilha';

/**
 * "Processar Arquivo" do Upload Base — porta de completar_vencimento, aplicar_mapeamento e
 * validar_dados_direito_creditorio (backend/modules/base_direito_creditorio.py).
 *
 * Diferenças deliberadas: valor vazio fica vazio (lá vira 0,0) e só é erro o valor preenchido que
 * não dá para ler; data preenchida que não dá para ler é erro (lá o fillna("") final apagava a data
 * em silêncio antes da validação, que nunca disparava).
 */

/**
 * Mapeamento que vale no processamento. Sem nenhum mapeamento informado (objeto vazio ou ausente),
 * como no registro_base: as colunas que já têm o nome do padrão e, se nenhuma tiver, as sugestões
 * do mapeamento inteligente. Com mapeamento, as colunas sem destino ('') ficam de fora.
 */
export function mapeamentoEfetivo(mapeamento: Record<string, string> | null | undefined, colunas: string[]): Record<string, string> {
  const padrao = COLUNAS_UPLOAD as readonly string[];
  if (!mapeamento || !Object.keys(mapeamento).length) {
    const exatas = Object.fromEntries(colunas.filter((c) => padrao.includes(c)).map((c) => [c, c]));
    return Object.keys(exatas).length ? exatas : mapeamentoInteligente(colunas, padrao);
  }
  const usados = new Set<string>();
  const saida: Record<string, string> = {};
  for (const [coluna, destino] of Object.entries(mapeamento)) {
    // Destino desconhecido, coluna que não existe no arquivo ou destino repetido (vale a primeira).
    if (!destino || !padrao.includes(destino) || !colunas.includes(coluna) || usados.has(destino)) continue;
    usados.add(destino);
    saida[coluna] = destino;
  }
  return saida;
}

export type OrigemVencimento = {
  /** Coluna do arquivo que alimenta o vencimento (null: nenhuma). */
  escolhida: string | null;
  /** Colunas usadas quando a escolhida está vazia, na ordem. */
  alternativas: string[];
};

/**
 * completar_vencimento: vale a coluna escolhida para o vencimento; numa linha em que ela estiver
 * vazia, usa a outra coluna de vencimento do arquivo (original × ajustada). Nada mapeado para o
 * vencimento: a coluna de vencimento do arquivo assume.
 */
export function completarVencimento(mapeamento: Record<string, string>, colunas: string[]): { mapeamento: Record<string, string>; origem: OrigemVencimento } {
  let escolhida = Object.keys(mapeamento).find((k) => mapeamento[k] === CAMPO_VENCIMENTO) ?? null;
  const alternativas = colunasDeVencimento(colunas).filter((c) => c !== escolhida);
  let saida = mapeamento;
  if (escolhida === null) {
    if (!alternativas.length) return { mapeamento, origem: { escolhida: null, alternativas: [] } };
    escolhida = alternativas.shift()!;
    saida = { ...mapeamento, [escolhida]: CAMPO_VENCIMENTO };
  }
  return { mapeamento: saida, origem: { escolhida, alternativas } };
}

export type ResultadoProcessamento =
  | { ok: false; erros: ErroValidacao[] }
  | {
    ok: true;
    titulos: TituloImportado[];
    mapeamento: Record<string, string>;
    /** Quantas linhas tiveram o vencimento completado por outra coluna, e de qual. */
    vencimento: { coluna: string | null; completados: number; por_coluna: Record<string, number> };
  };

/** aplicar_mapeamento + validação: os títulos da base, ou os erros por campo com as linhas do Excel. */
export function aplicarMapeamento(tabela: Tabela, mapeamentoInformado: Record<string, string> | null | undefined): ResultadoProcessamento {
  const { mapeamento, origem } = completarVencimento(mapeamentoEfetivo(mapeamentoInformado, tabela.colunas), tabela.colunas);
  const indiceDe = (coluna: string) => tabela.colunas.indexOf(coluna);
  const fonte = new Map<string, number>();
  for (const [coluna, destino] of Object.entries(mapeamento)) fonte.set(destino, indiceDe(coluna));
  const alternativas = origem.alternativas.map((c) => ({ coluna: c, indice: indiceDe(c) }));
  const porColuna: Record<string, number> = {};

  const erros = new Map<string, ErroValidacao>();
  const anotar = (tipo: ErroValidacao['tipo'], campo: string, linha: number) => {
    const chave = `${tipo}:${campo}`;
    const e = erros.get(chave) ?? { tipo, campo, linhas: [] };
    e.linhas.push(linha);
    erros.set(chave, e);
  };

  const titulos: TituloImportado[] = [];
  for (const linha of tabela.linhas) {
    const cru = (campo: string): unknown => {
      const i = fonte.get(campo);
      let v = i === undefined ? null : linha.valores[i];
      if (campo === CAMPO_VENCIMENTO && textoDaCelula(v) === null) {
        for (const alt of alternativas) {
          if (textoDaCelula(linha.valores[alt.indice]) !== null) {
            v = linha.valores[alt.indice];
            porColuna[alt.coluna] = (porColuna[alt.coluna] ?? 0) + 1;
            break;
          }
        }
      }
      return v;
    };
    const valores = Object.fromEntries(COLUNAS_UPLOAD.map((c) => [c, cru(c)])) as Record<string, unknown>;
    for (const campo of COLUNAS_OBRIGATORIAS) if (textoDaCelula(valores[campo]) === null) anotar('vazio', campo, linha.numero);
    const datas: Record<string, string | null> = {};
    for (const campo of COLUNAS_DATA) {
      datas[campo] = lerData(valores[campo]);
      if (datas[campo] === null && textoDaCelula(valores[campo]) !== null) anotar('data', campo, linha.numero);
    }
    const dinheiro: Record<string, string | null> = {};
    for (const campo of COLUNAS_VALOR) {
      dinheiro[campo] = lerMoeda(valores[campo]);
      const texto = textoDaCelula(valores[campo]);
      // lerMoeda devolve null também para zero: zero escrito não é erro.
      if (dinheiro[campo] === null && texto !== null && !/^[R$\s0.,+-]*$/.test(texto)) anotar('valor', campo, linha.numero);
    }
    const texto = (campo: string, limite?: number) => textoDaCelula(valores[campo], limite);
    titulos.push({
      linha_origem: linha.numero,
      id_base_origem: null,
      // Como no Bate Lastro: número que o Excel guardou como decimal perde o ".0".
      numero_documento: texto('NU_DOCUMENTO', 100)?.replace(/\.0$/, '') ?? null,
      sacado_nome: texto('NOME_SACADO', 255),
      sacado_documento: texto('DOC_SACADO', 50),
      cedente_nome: texto('NOME_CEDENTE', 255),
      cedente_documento: texto('DOC_CEDENTE', 50),
      valor_total: dinheiro.VALOR_NOMINAL,
      valor_aquisicao: dinheiro.VALOR_AQUISICAO,
      data_emissao: datas.DATA_EMISSAO,
      data_vencimento: datas.DATA_VENCIMENTO_ORIGINAL,
      data_aquisicao: datas.DATA_AQUISICAO,
      nome_fundo: null,
      cnpj_fundo: null,
      tipo_recebivel: texto('TIPO_RECEBIVEL'),
      chave_nfe: texto('CHAVE_NFE'),
      lados: { termo: 'pendente', lastro: 'pendente' },
    });
  }

  if (erros.size) {
    // Mesma ordem do Bate Lastro: obrigatórios, datas, valores (cada grupo na ordem das colunas).
    const ordem = (e: ErroValidacao) => (e.tipo === 'vazio' ? 0 : e.tipo === 'data' ? 1 : 2) * 100 + (COLUNAS_UPLOAD as readonly string[]).indexOf(e.campo);
    return { ok: false, erros: [...erros.values()].sort((a, b) => ordem(a) - ordem(b)) };
  }
  return {
    ok: true,
    titulos,
    mapeamento,
    vencimento: { coluna: origem.escolhida, completados: Object.values(porColuna).reduce((a, n) => a + n, 0), por_coluna: porColuna },
  };
}
