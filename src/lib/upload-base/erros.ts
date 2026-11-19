/**
 * Erros de validação do Upload Base (validar_dados_direito_creditorio) e o resumo que a tela
 * mostra, do mesmo jeito do Bate Lastro: "'X' vazio em N linhas", os 3 primeiros e
 * "(+N outros erros)". Sem dependências: vale no servidor e no navegador.
 */

export type ErroValidacao = {
  /** vazio: campo obrigatório vazio | data: data que não dá para ler | valor: valor que não dá para ler. */
  tipo: 'vazio' | 'data' | 'valor';
  campo: string;
  /** Linhas do Excel (a linha 1 é o cabeçalho). */
  linhas: number[];
};

export const MENSAGEM_DADOS_INVALIDOS = 'Dados inválidos encontrados';

const MAX_LINHAS_NA_MENSAGEM = 20;

function listaDeLinhas(linhas: number[]): string {
  const mostradas = linhas.slice(0, MAX_LINHAS_NA_MENSAGEM).join(', ');
  return linhas.length > MAX_LINHAS_NA_MENSAGEM ? `${mostradas} e mais ${linhas.length - MAX_LINHAS_NA_MENSAGEM}` : mostradas;
}

/** Mensagem completa de um erro, com as linhas (o "detalhe" do Bate Lastro). */
export function descreverErro(e: ErroValidacao): string {
  const linhas = listaDeLinhas(e.linhas);
  if (e.tipo === 'vazio') return `Campo obrigatório '${e.campo}' está vazio nas linhas: ${linhas}`;
  if (e.tipo === 'data') return `Formato de data inválido na coluna '${e.campo}' nas linhas: ${linhas}`;
  return `Valores inválidos encontrados na coluna '${e.campo}' nas linhas: ${linhas}`;
}

const plural = (n: number) => `${n} ${n === 1 ? 'linha' : 'linhas'}`;

/** Um erro em poucas palavras ("'NOME_CEDENTE' vazio em 3 linhas"). */
export function resumoDoErro(e: ErroValidacao): string {
  if (e.tipo === 'vazio') return `'${e.campo}' vazio em ${plural(e.linhas.length)}`;
  if (e.tipo === 'data') return `data inválida em '${e.campo}' em ${plural(e.linhas.length)}`;
  return `valor inválido em '${e.campo}' em ${plural(e.linhas.length)}`;
}

/** "Dados inválidos encontrados: 'A' vazio em 2 linhas; 'B' vazio em 1 linha; … (+2 outros erros)". */
export function resumirErros(erros: ErroValidacao[], mensagem = MENSAGEM_DADOS_INVALIDOS): string {
  if (!erros.length) return mensagem;
  let texto = `${mensagem}: ${erros.slice(0, 3).map(resumoDoErro).join('; ')}`;
  if (erros.length > 3) texto += ` (+${erros.length - 3} ${erros.length - 3 === 1 ? 'outro erro' : 'outros erros'})`;
  return texto;
}
