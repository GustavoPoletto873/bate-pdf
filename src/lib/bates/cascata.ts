import { codigoAlfanumerico, diaDaData } from '@/lib/bates/comparacao';

/**
 * A cascata do "Processar Base" do Bate Lastro (MatchServiceV2._sync_cascata_matching, em
 * backend/services/match_service_v2.py), portada linha a linha. Módulo puro.
 *
 * Gulosa: os critérios são tentados em ordem de prioridade; em cada um, cada título (na ordem
 * em que vem) pega o primeiro candidato que confere em todos os campos do critério, e os dois
 * saem do jogo. A similaridade só diz em qual critério o par caiu: 1,0 − 0,1 × índice (mínimo
 * 0,2). Depois da cascata exata, uma 2ª passada tenta o nº da base sem o sufixo de parcela
 * (172137001 → 172137) só nos critérios que também exigem o valor.
 *
 * Normalização (igual à de lá): nº = a primeira sequência de dígitos sem zeros à esquerda;
 * CPF/CNPJ = strip().upper() (sem tirar pontuação); valor = float (vazio = 0); datas ±1 dia;
 * valor igual se a diferença relativa ao menor for ≤ 0,5% (dois zeros são iguais).
 */

export type CampoCascata =
  | 'NU_DOCUMENTO' | 'VALOR_NOMINAL' | 'DATA_VENCIMENTO_ORIGINAL' | 'DOC_CEDENTE' | 'DOC_SACADO'
  | 'DATA_EMISSAO' | 'DATA_AQUISICAO';

export const CRITERIOS: CampoCascata[][] = [
  ['NU_DOCUMENTO', 'VALOR_NOMINAL', 'DATA_VENCIMENTO_ORIGINAL', 'DOC_CEDENTE', 'DOC_SACADO'],
  ['NU_DOCUMENTO', 'VALOR_NOMINAL', 'DATA_VENCIMENTO_ORIGINAL', 'DOC_SACADO'],
  ['NU_DOCUMENTO', 'VALOR_NOMINAL', 'DATA_VENCIMENTO_ORIGINAL', 'DOC_CEDENTE'],
  ['DOC_SACADO', 'DOC_CEDENTE', 'VALOR_NOMINAL', 'DATA_VENCIMENTO_ORIGINAL'],
  ['NU_DOCUMENTO', 'VALOR_NOMINAL', 'DATA_VENCIMENTO_ORIGINAL'],
  ['DOC_SACADO', 'VALOR_NOMINAL', 'DATA_VENCIMENTO_ORIGINAL'],
  ['NU_DOCUMENTO', 'VALOR_NOMINAL'],
  ['NU_DOCUMENTO', 'DATA_VENCIMENTO_ORIGINAL'],
  ['NU_DOCUMENTO', 'DATA_EMISSAO'],
  ['NU_DOCUMENTO', 'DATA_AQUISICAO'],
  ['VALOR_NOMINAL', 'DATA_AQUISICAO', 'DATA_VENCIMENTO_ORIGINAL'],
];

/** Rótulo de cada critério (1 a 11) para a tela. */
export const ROTULO_CRITERIO: Record<number, string> = {
  1: 'Nº, valor, vencimento, CNPJ do cedente e CPF/CNPJ do sacado',
  2: 'Nº, valor, vencimento e CPF/CNPJ do sacado',
  3: 'Nº, valor, vencimento e CNPJ do cedente',
  4: 'Sacado, cedente, valor e vencimento',
  5: 'Nº, valor e vencimento',
  6: 'Sacado, valor e vencimento',
  7: 'Nº e valor',
  8: 'Nº e vencimento',
  9: 'Nº e emissão',
  10: 'Nº e data de aquisição',
  11: 'Valor, data de aquisição e vencimento',
};

/** Um registro da base (título) ou de leitura, com os campos que a cascata usa. */
export type RegistroCascata = {
  id: number;
  numero_documento: string | null;
  valor: string | number | null;
  data_vencimento: string | null;
  data_emissao: string | null;
  data_aquisicao: string | null;
  doc_cedente: string | null;
  doc_sacado: string | null;
};

export type ParCascata = {
  base_id: number;
  leitura_id: number;
  /** Nível do critério (1 a 11). */
  criterio: number;
  similaridade: number;
  /** Achado na 2ª passada (nº da base sem a parcela). */
  sem_parcela: boolean;
};

type Proc = {
  id: number;
  numero: string;
  semParcela: string;
  codigo: string | null;
  valor: number;
  venc: number | null;
  emissao: number | null;
  aquisicao: number | null;
  cedente: string;
  sacado: string;
};

/** _preprocess_document: a primeira sequência de dígitos, sem zeros à esquerda ("" sem dígito). */
export function numeroDaCascata(doc: unknown): string {
  if (doc === null || doc === undefined) return '';
  const m = /\d+/.exec(String(doc));
  if (!m) return '';
  return m[0].replace(/^0+/, '') || '0';
}

/** _numero_sem_parcela: só dígitos, ≥ 7 sem os zeros à esquerda e terminando em 001–099. */
export function numeroSemParcela(doc: unknown): string {
  if (doc === null || doc === undefined) return '';
  const s = String(doc).trim();
  if (!/^\d+$/.test(s)) return '';
  const numero = s.replace(/^0+/, '');
  const parcela = numero.slice(-3);
  if (numero.length < 7 || !(parcela >= '001' && parcela <= '099')) return '';
  return numero.slice(0, -3);
}

function textoProc(s: unknown): string {
  if (s === null || s === undefined) return '';
  return String(s).trim().toUpperCase();
}

function valorProc(v: unknown): number {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function preprocessar(r: RegistroCascata, ehBase: boolean): Proc {
  return {
    id: r.id,
    numero: numeroDaCascata(r.numero_documento),
    semParcela: ehBase ? numeroSemParcela(r.numero_documento) : '',
    codigo: codigoAlfanumerico(r.numero_documento),
    valor: valorProc(r.valor),
    venc: diaDaData(r.data_vencimento),
    emissao: diaDaData(r.data_emissao),
    aquisicao: diaDaData(r.data_aquisicao),
    cedente: textoProc(r.doc_cedente),
    sacado: textoProc(r.doc_sacado),
  };
}

const arred2 = (v: number) => Math.round(v * 100) / 100;

function datasIguais(a: number | null, b: number | null): boolean {
  return a !== null && b !== null && Math.abs(a - b) <= 1;
}

/** compare_values_fast (com a mesma divisão pelo menor, inclusive para negativos). */
function valoresIguais(a: number, b: number): boolean {
  if (a === 0 || b === 0) return a === b;
  const menor = Math.min(a, b);
  if (menor === 0) return false;
  return Math.abs(a - b) / menor <= 0.005;
}

type Indices = {
  numero: Map<string, Proc[]>;
  sacado: Map<string, Proc[]>;
  cedente: Map<string, Proc[]>;
  valor: Map<number, Proc[]>;
  valorVenc: Map<string, Proc[]>;
};

function empilhar<K>(m: Map<K, Proc[]>, k: K, p: Proc) {
  const lista = m.get(k);
  if (lista) lista.push(p);
  else m.set(k, [p]);
}

function criarIndices(leituras: Proc[]): Indices {
  const ix: Indices = { numero: new Map(), sacado: new Map(), cedente: new Map(), valor: new Map(), valorVenc: new Map() };
  for (const l of leituras) {
    if (l.numero) empilhar(ix.numero, l.numero, l);
    if (l.sacado) empilhar(ix.sacado, l.sacado, l);
    if (l.cedente) empilhar(ix.cedente, l.cedente, l);
    const v = arred2(l.valor);
    empilhar(ix.valor, v, l);
    if (l.venc !== null) empilhar(ix.valorVenc, `${v}|${l.venc}`, l);
  }
  return ix;
}

/** "Chave curta tirada de dentro de um código não identifica o título" (numero_identifica). */
function numeroIdentifica(base: Proc, leitura: Proc, chave: string): boolean {
  if (chave.length >= 4) return true;
  const cb = base.codigo;
  const cl = leitura.codigo;
  if (cb === null && cl === null) return true;
  if (cb === null || cl === null) return false;
  return cb.startsWith(cl) || cl.startsWith(cb);
}

export function cascata(registrosBase: RegistroCascata[], registrosLeitura: RegistroCascata[]): {
  pares: ParCascata[];
  basesSemPar: number[];
  leiturasSemPar: number[];
} {
  let bases = registrosBase.map((r) => preprocessar(r, true));
  let leituras = registrosLeitura.map((r) => preprocessar(r, false));
  let indices = criarIndices(leituras);
  const pares: ParCascata[] = [];

  const executar = (criterios: [number, CampoCascata[]][], campoNumero: 'numero' | 'semParcela') => {
    for (const [idx, criterio] of criterios) {
      if (!bases.length || !leituras.length) break;
      const tem = (c: CampoCascata) => criterio.includes(c);
      // Documento vazio dos dois lados não é documento igual.
      const obrigatorios: ((b: Proc) => string)[] = [];
      if (tem('NU_DOCUMENTO')) obrigatorios.push((b) => b[campoNumero]);
      if (tem('DOC_SACADO')) obrigatorios.push((b) => b.sacado);
      if (tem('DOC_CEDENTE')) obrigatorios.push((b) => b.cedente);
      // Sem sacado/cedente e sem valor+vencimento juntos, o número sustenta o par sozinho.
      const numeroUnicoIdentificador = tem('NU_DOCUMENTO') && !tem('DOC_SACADO') && !tem('DOC_CEDENTE')
        && !(tem('VALOR_NOMINAL') && tem('DATA_VENCIMENTO_ORIGINAL'));
      const similaridadeDoCriterio = Math.max(1.0 - idx * 0.1, 0.2);

      const leiturasUsadas = new Set<number>();
      const basesUsadas = new Set<number>();
      for (const base of bases) {
        if (basesUsadas.has(base.id)) continue;
        if (!obrigatorios.every((f) => f(base))) continue;

        const primeiro = criterio[0];
        let candidatos: Proc[];
        if (primeiro === 'NU_DOCUMENTO' && base[campoNumero]) {
          candidatos = indices.numero.get(base[campoNumero]) ?? [];
        } else if (primeiro === 'DOC_SACADO' && base.sacado) {
          candidatos = indices.sacado.get(base.sacado) ?? [];
        } else if (primeiro === 'DOC_CEDENTE' && base.cedente) {
          candidatos = indices.cedente.get(base.cedente) ?? [];
        } else if (tem('DATA_VENCIMENTO_ORIGINAL') && base.venc !== null) {
          // Valor + vencimento (±1 dia): bem mais discriminante que o valor sozinho.
          const vistos = new Set<number>();
          candidatos = [];
          for (const delta of [-1, 0, 1]) {
            for (const l of indices.valorVenc.get(`${base.valor}|${base.venc + delta}`) ?? []) {
              if (!vistos.has(l.id)) { vistos.add(l.id); candidatos.push(l); }
            }
          }
        } else {
          candidatos = indices.valor.get(base.valor) ?? [];
        }

        let melhor: Proc | null = null;
        for (const leitura of candidatos) {
          if (leiturasUsadas.has(leitura.id)) continue;
          let confere = true;
          for (const campo of criterio) {
            if (campo === 'NU_DOCUMENTO') {
              if (base[campoNumero] !== leitura.numero || (numeroUnicoIdentificador && !numeroIdentifica(base, leitura, base[campoNumero]))) { confere = false; break; }
            } else if (campo === 'VALOR_NOMINAL') {
              if (!valoresIguais(base.valor, leitura.valor)) { confere = false; break; }
            } else if (campo === 'DATA_VENCIMENTO_ORIGINAL') {
              if (!datasIguais(base.venc, leitura.venc)) { confere = false; break; }
            } else if (campo === 'DATA_EMISSAO') {
              if (!datasIguais(base.emissao, leitura.emissao)) { confere = false; break; }
            } else if (campo === 'DATA_AQUISICAO') {
              if (!datasIguais(base.aquisicao, leitura.aquisicao)) { confere = false; break; }
            } else if (campo === 'DOC_CEDENTE') {
              if (base.cedente !== leitura.cedente) { confere = false; break; }
            } else if (campo === 'DOC_SACADO') {
              if (base.sacado !== leitura.sacado) { confere = false; break; }
            }
          }
          // Todos os candidatos de um critério têm a mesma similaridade: vale o primeiro que confere.
          if (confere) { melhor = leitura; break; }
        }

        if (melhor) {
          pares.push({ base_id: base.id, leitura_id: melhor.id, criterio: idx + 1, similaridade: similaridadeDoCriterio, sem_parcela: campoNumero === 'semParcela' });
          basesUsadas.add(base.id);
          leiturasUsadas.add(melhor.id);
        }
      }

      bases = bases.filter((b) => !basesUsadas.has(b.id));
      leituras = leituras.filter((l) => !leiturasUsadas.has(l.id));
      if (leituras.length) indices = criarIndices(leituras);
    }
  };

  executar(CRITERIOS.map((c, i) => [i, c]), 'numero');
  // 2ª passada, só sobre o que sobrou: nº sem a parcela, e só onde o valor também precisa bater.
  executar(
    CRITERIOS.map((c, i) => [i, c] as [number, CampoCascata[]]).filter(([, c]) => c.includes('NU_DOCUMENTO') && c.includes('VALOR_NOMINAL')),
    'semParcela',
  );

  return { pares, basesSemPar: bases.map((b) => b.id), leiturasSemPar: leituras.map((l) => l.id) };
}
