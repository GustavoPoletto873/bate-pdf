import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import { pastaDeDados } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';

/**
 * Carteira do fundo pelo Informe Mensal FIDC da CVM — porta de
 * services/Relatorios/informe_mensal_service.py do Bate Lastro (mesmas linhas, mesmo rateio).
 *
 * O ZIP da competência vem do portal de dados abertos da CVM (público) e fica guardado em
 * <dados>/cvm/: é o mesmo arquivo para todos os fundos do mês.
 */

export const URL_INFORME = (comp: string) => `https://dados.cvm.gov.br/dados/FIDC/DOC/INF_MENSAL/DADOS/inf_mensal_fidc_${comp}.zip`;

export const LINHA_VINCENDOS = 'Direitos creditórios vincendos';
export const LINHA_VENCIDOS = 'Direitos creditórios vencidos';
const LINHA_FIF = 'Cotas de fundos de renda fixa';
const LINHA_FIDC = 'Cotas de fundos de direito creditório';
const LINHA_DISPONIBILIDADES = 'Disponibilidades';
const LINHA_TIT_PUBLICOS = 'Títulos públicos';
const LINHA_TIT_PRIVADOS = 'Títulos privados';
const LINHA_PDD = 'Provisão para perdas com direitos creditórios';
const LINHA_VALORES_PAGAR = 'Valores a pagar / a receber';

export const LINHAS_CARTEIRA = [
  LINHA_VINCENDOS, LINHA_VENCIDOS, LINHA_FIF, LINHA_FIDC, LINHA_DISPONIBILIDADES,
  LINHA_TIT_PUBLICOS, LINHA_TIT_PRIVADOS, LINHA_PDD, LINHA_VALORES_PAGAR,
];

const MAPEAMENTO: Record<string, string> = {
  'Disponibilidades': LINHA_DISPONIBILIDADES,
  'Direitos Creditorios COM a Vencer': LINHA_VINCENDOS,
  'Direitos Creditorios COM a Vencidos': LINHA_VENCIDOS,
  'Direitos Creditorios SEM a Vencer': LINHA_VINCENDOS,
  'Direitos Creditorios SEM a Vencidos': LINHA_VENCIDOS,
  'PDD COM': LINHA_PDD,
  'PDD SEM': LINHA_PDD,
  'Cotas de FIF': LINHA_FIF,
  'Cotas de Fundos 555': LINHA_FIF,
  'Debentures': LINHA_TIT_PRIVADOS,
  'CRI': LINHA_TIT_PRIVADOS,
  'Notas Promissorias': LINHA_TIT_PRIVADOS,
  'Outros valores mobiliarios': LINHA_VALORES_PAGAR,
  'Titulos Publicos Federais': LINHA_TIT_PUBLICOS,
  'CDB': LINHA_TIT_PRIVADOS,
  'Operacoes Compromissadas': LINHA_TIT_PRIVADOS,
  'Outros ativos de renda fixa': LINHA_TIT_PRIVADOS,
  'Cotas de FIDC': LINHA_FIDC,
  'Cotas de FIDC NP': LINHA_FIDC,
  'Outros Ativos': LINHA_VALORES_PAGAR,
  'Valores a pagar': LINHA_VALORES_PAGAR,
  'Posicao em Derivativos - Passivo': LINHA_VALORES_PAGAR,
};

const NEGATIVOS = new Set(['PDD SEM', 'PDD COM', 'PDD Vencidos', 'Valores a pagar']);

const RENOMEAR: [string, string][] = [
  ['TAB_I1_VL_DISP', 'Disponibilidades'],
  ['DC_COM_A_VENCER', 'Direitos Creditorios COM a Vencer'],
  ['DC_COM_A_VENCIDOS', 'Direitos Creditorios COM a Vencidos'],
  ['TAB_I2A11_VL_REDUCAO_RECUP', 'PDD COM'],
  ['DC_SEM_A_VENCER', 'Direitos Creditorios SEM a Vencer'],
  ['DC_SEM_A_VENCIDOS', 'Direitos Creditorios SEM a Vencidos'],
  ['TAB_I2B11_VL_REDUCAO_RECUP', 'PDD SEM'],
  ['TAB_I2C5_VL_COTA_FIF', 'Cotas de FIF'],
  ['TAB_I2C5_VL_COTA_FUNDO_ICVM555', 'Cotas de Fundos 555'],
  ['TAB_I2C1_VL_DEBENTURE', 'Debentures'],
  ['TAB_I2C2_VL_CRI', 'CRI'],
  ['TAB_I2C3_VL_NP_COMERC', 'Notas Promissorias'],
  ['TAB_I2C6_VL_OUTRO', 'Outros valores mobiliarios'],
  ['TAB_I2D_VL_TITPUB_FED', 'Titulos Publicos Federais'],
  ['TAB_I2E_VL_CDB', 'CDB'],
  ['TAB_I2F_VL_OPER_COMPROM', 'Operacoes Compromissadas'],
  ['TAB_I2G_VL_OUTRO_RF', 'Outros ativos de renda fixa'],
  ['TAB_I2H_VL_COTA_FIDC', 'Cotas de FIDC'],
  ['TAB_I2I_VL_COTA_FIDC_NP', 'Cotas de FIDC NP'],
  ['TAB_I4_VL_OUTRO_ATIVO', 'Outros Ativos'],
  ['TAB_III_A_VL_PAGAR', 'Valores a pagar'],
  ['TAB_III_B_VL_POSICAO_DERIV', 'Posicao em Derivativos - Passivo'],
];

export type ClasseCota = { descricao: string; valor: number; quantidade_cotas: number; valor_cota: number };
export type Carteira = { cnpj: string; data_base: string; linhas: Record<string, number>; classes: ClasseCota[] };

export const patrimonioLiquido = (c: Carteira) => c.classes.reduce((s, x) => s + x.valor, 0);
export const totalDireitosCreditorios = (c: Carteira) => (c.linhas[LINHA_VINCENDOS] ?? 0) + (c.linhas[LINHA_VENCIDOS] ?? 0);

export class InformeIndisponivel extends ErroDeUso {
  constructor(mensagem: string) { super(mensagem, 424); }
}

/** 'AAAAMM' da data-base ISO. */
export const competencia = (dataBase: string) => dataBase.slice(0, 7).replace('-', '');

type Linha = Record<string, string>;
export type Tabelas = { I: Linha[]; III: Linha[]; X_2: Linha[] };

/** CSV da CVM: `;`, latin1, primeira linha = cabeçalho. Campos com aspas são raros; tratados. */
export function lerCsv(texto: string): Linha[] {
  const linhas = texto.split(/\r?\n/).filter((l) => l.length);
  if (!linhas.length) return [];
  const dividir = (l: string) => {
    if (!l.includes('"')) return l.split(';');
    const campos: string[] = [];
    let atual = '';
    let aspas = false;
    for (let i = 0; i < l.length; i++) {
      const c = l[i];
      if (c === '"') { if (aspas && l[i + 1] === '"') { atual += '"'; i++; } else aspas = !aspas; }
      else if (c === ';' && !aspas) { campos.push(atual); atual = ''; }
      else atual += c;
    }
    campos.push(atual);
    return campos;
  };
  const cab = dividir(linhas[0]).map((c) => c.trim());
  return linhas.slice(1).map((l) => {
    const v = dividir(l);
    return Object.fromEntries(cab.map((c, i) => [c, v[i] ?? '']));
  });
}

export type Baixar = (url: string) => Promise<Response>;

async function zipDaCompetencia(comp: string, baixar: Baixar, forcar: boolean): Promise<Uint8Array> {
  const pasta = join(/*turbopackIgnore: true*/ pastaDeDados(), 'cvm');
  const arquivo = join(pasta, `inf_mensal_fidc_${comp}.zip`);
  if (!forcar && existsSync(arquivo)) return new Uint8Array(readFileSync(arquivo));
  let r: Response;
  try {
    r = await baixar(URL_INFORME(comp));
  } catch {
    throw new InformeIndisponivel(`Não foi possível acessar o portal de dados da CVM (informe ${comp}). Confira a internet e tente de novo.`);
  }
  if (r.status === 404) throw new InformeIndisponivel(`A CVM ainda não publicou o informe mensal da competência ${comp.slice(4)}/${comp.slice(0, 4)}.`);
  if (!r.ok) throw new InformeIndisponivel(`Informe mensal ${comp} indisponível na CVM (HTTP ${r.status}).`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  mkdirSync(pasta, { recursive: true });
  writeFileSync(arquivo, bytes);
  return bytes;
}

/** Tabelas I, III e X_2 da competência (baixa uma vez e guarda). */
export async function baixarInforme(dataBase: string, baixar: Baixar = fetch, forcar = false): Promise<Tabelas> {
  const comp = competencia(dataBase);
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(await zipDaCompetencia(comp, baixar, forcar));
  } catch (e) {
    if (e instanceof InformeIndisponivel) throw e;
    throw new InformeIndisponivel(`O arquivo do informe mensal ${comp} veio corrompido da CVM. Tente "Atualizar coleta".`);
  }
  const ler = async (chave: 'I' | 'III' | 'X_2') => {
    const nome = `inf_mensal_fidc_tab_${chave}_${comp}.csv`;
    const f = zip.file(nome);
    if (!f) throw new InformeIndisponivel(`O informe mensal ${comp} não tem a tabela ${chave} (${nome}). A CVM publica essa tabela com atraso em algumas competências.`);
    return lerCsv(new TextDecoder('latin1').decode(await f.async('uint8array')));
  };
  return { I: await ler('I'), III: await ler('III'), X_2: await ler('X_2') };
}

const num = (v: string | undefined) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * "A vencer com parcelas inadimplentes" vai em parte para vencidos: a parcela já vencida
 * (a.2.1) sai do vincendo. a Vencer = a.1 + (a.2 − a.2.1); Vencidos = a.3 + a.2.1.
 */
export function ratearVencerVencidos(l: Linha): Record<string, number> {
  const saida: Record<string, number> = {};
  for (const [bloco, sufixo] of [['A', 'COM'], ['B', 'SEM']] as const) {
    const ad = num(l[`TAB_I2${bloco}1_VL_CRED_VENC_AD`]);
    const inad = num(l[`TAB_I2${bloco}2_VL_CRED_VENC_INAD`]);
    const parcela = num(l[`TAB_I2${bloco}21_VL_TOTAL_PARCELA_INAD`]);
    const inadimplente = num(l[`TAB_I2${bloco}3_VL_CRED_INAD`]);
    saida[`DC_${sufixo}_A_VENCER`] = ad + (inad - parcela);
    saida[`DC_${sufixo}_A_VENCIDOS`] = inadimplente + parcela;
  }
  return saida;
}

/** Carteira de cada CNPJ (formatado 00.000.000/0001-00, como a CVM publica). */
export function coletarCarteiras(dataBase: string, cnpjs: string[], t: Tabelas): Map<string, Carteira> {
  const alvo = new Set(cnpjs.filter(Boolean));
  const saida = new Map<string, Carteira>();
  for (const cnpj of alvo) {
    const ativo = t.I.find((l) => l.CNPJ_FUNDO_CLASSE === cnpj);
    if (!ativo) continue;
    const passivo = t.III.find((l) => l.CNPJ_FUNDO_CLASSE === cnpj) ?? {};
    const registro: Linha = { ...ativo, TAB_III_A_VL_PAGAR: passivo.TAB_III_A_VL_PAGAR ?? '', TAB_III_B_VL_POSICAO_DERIV: passivo.TAB_III_B_VL_POSICAO_DERIV ?? '' };
    const rateio = ratearVencerVencidos(registro);
    const linhas: Record<string, number> = Object.fromEntries(LINHAS_CARTEIRA.map((r) => [r, 0]));
    for (const [coluna, descricao] of RENOMEAR) {
      const destino = MAPEAMENTO[descricao];
      if (!destino) continue;
      let valor = coluna in rateio ? rateio[coluna] : num(registro[coluna]);
      if (!valor) continue;
      if (NEGATIVOS.has(descricao)) valor = -Math.abs(valor);
      linhas[destino] = (linhas[destino] ?? 0) + valor;
    }
    const classes: ClasseCota[] = t.X_2.filter((l) => l.CNPJ_FUNDO_CLASSE === cnpj)
      .map((l) => ({ descricao: (l.TAB_X_CLASSE_SERIE ?? '').trim(), quantidade_cotas: num(l.TAB_X_QT_COTA), valor_cota: num(l.TAB_X_VL_COTA) }))
      .filter((c) => c.quantidade_cotas !== 0)
      .map((c) => {
        const valor = c.quantidade_cotas * c.valor_cota;
        return { ...c, valor: c.descricao.toLowerCase().includes('subclasse') ? Math.abs(valor) : valor };
      });
    saida.set(cnpj, { cnpj, data_base: dataBase, linhas, classes });
  }
  return saida;
}
