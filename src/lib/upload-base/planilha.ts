import { colunasDeVencimento, lerAbas, mapeamentoInteligente, PlanilhaRecusada, textoDaCelula, type Aba } from '@/lib/planilha/importar';
import { COLUNAS_UPLOAD, type AnaliseArquivo } from './colunas';

/**
 * Leitura da planilha do Upload Base (o pandas.read_excel / read_csv de analisar_arquivo e
 * registro_base): cabeçalho na primeira linha preenchida, uma coluna por nome (nomes repetidos
 * ganham ".1", ".2", como no pandas) e linhas totalmente vazias ignoradas. Cada linha guarda o
 * número dela no Excel, para os erros apontarem a linha que a pessoa vê.
 */

export type LinhaTabela = { numero: number; valores: unknown[] };
export type Tabela = { aba: string; colunas: string[]; linhas: LinhaTabela[] };

const vazia = (v: unknown) => textoDaCelula(v) === null;

function letraDaColuna(indice: number): string {
  let n = indice + 1;
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function tabelaDaAba(aba: Aba): Tabela | null {
  const inicio = aba.linhas.findIndex((l) => l.some((v) => !vazia(v)));
  if (inicio < 0) return null;
  const cabecalho = aba.linhas[inicio];
  const dados = aba.linhas.slice(inicio + 1);
  const largura = Math.max(cabecalho.length, ...dados.map((l) => l.length));
  const usadas = new Map<string, number>();
  const colunas: string[] = [];
  const indices: number[] = [];
  for (let i = 0; i < largura; i++) {
    let nome = textoDaCelula(cabecalho[i]);
    if (!nome) {
      // Coluna sem título: só entra se tiver algum dado.
      if (dados.every((l) => vazia(l[i]))) continue;
      nome = `Coluna sem título (${letraDaColuna(i)})`;
    }
    const vezes = usadas.get(nome) ?? 0;
    usadas.set(nome, vezes + 1);
    colunas.push(vezes ? `${nome}.${vezes}` : nome);
    indices.push(i);
  }
  const linhas: LinhaTabela[] = [];
  dados.forEach((l, j) => {
    const valores = indices.map((i) => l[i] ?? null);
    if (valores.some((v) => !vazia(v))) linhas.push({ numero: inicio + j + 2, valores });
  });
  return { aba: aba.nome, colunas, linhas };
}

/**
 * Lê a planilha da base. Com várias abas, vale a que tem mais colunas reconhecidas pelo mapeamento
 * (empate = a primeira, que é a que o Bate Lastro lê).
 */
export async function lerTabela(conteudo: Uint8Array, nomeArquivo: string): Promise<Tabela> {
  const extensao = /\.[^.]+$/.exec(nomeArquivo.toLowerCase())?.[0] ?? '';
  if (extensao === '.xls') {
    throw new PlanilhaRecusada('Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx (Arquivo › Salvar como › Pasta de Trabalho do Excel).');
  }
  if (!['.xlsx', '.csv', '.txt'].includes(extensao)) throw new PlanilhaRecusada('Formato de arquivo não suportado. Envie .xlsx ou .csv.');
  if (!conteudo.length) throw new PlanilhaRecusada('O arquivo está vazio.');
  const abas = await lerAbas(conteudo, nomeArquivo);
  let melhor: Tabela | null = null;
  let maior = -1;
  for (const aba of abas) {
    const t = tabelaDaAba(aba);
    if (!t) continue;
    const reconhecidas = Object.keys(mapeamentoInteligente(t.colunas, COLUNAS_UPLOAD)).length;
    if (reconhecidas > maior) { melhor = t; maior = reconhecidas; }
  }
  if (!melhor) throw new PlanilhaRecusada('A planilha está vazia ou não foi possível ler os dados.');
  if (!melhor.linhas.length) throw new PlanilhaRecusada('A planilha não tem nenhuma linha de dados abaixo do cabeçalho.');
  return melhor;
}

/** Célula como texto para a prévia (datas do Excel em DD/MM/AAAA). */
function textoDeExemplo(v: unknown): string {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const iso = v.toISOString().slice(0, 10);
    return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  }
  return textoDaCelula(v) ?? '';
}

/** analisar_arquivo: colunas do arquivo, sugestão de mapeamento e o que já está no padrão. */
export function analisarTabela(tabela: Tabela): AnaliseArquivo {
  const colunasPadrao = [...COLUNAS_UPLOAD] as string[];
  const sugestoes = mapeamentoInteligente(tabela.colunas, colunasPadrao);
  const jaPadrao = tabela.colunas.filter((c) => colunasPadrao.includes(c));
  return {
    colunas_arquivo: tabela.colunas,
    colunas_padrao: colunasPadrao,
    total_linhas: tabela.linhas.length,
    sugestoes_mapeamento: sugestoes,
    colunas_ja_padrao: jaPadrao,
    precisa_mapeamento: jaPadrao.length < colunasPadrao.length,
    cobertura_automatica: Object.keys(sugestoes).length,
    colunas_vencimento: colunasDeVencimento(tabela.colunas),
    aba: tabela.aba,
    exemplo: tabela.linhas.slice(0, 3).map((l) => Object.fromEntries(tabela.colunas.map((c, i) => [c, textoDeExemplo(l.valores[i])]))),
  };
}
