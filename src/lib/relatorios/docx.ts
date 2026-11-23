import JSZip from 'jszip';

/**
 * Preenchimento dos modelos DOCX dos relatórios CVM/NIX — porta de
 * services/Relatorios/docx_service.py do Bate Lastro, direto sobre o XML do Word.
 *
 * - `{{campo}}` vira o valor do contexto. O Word quebra o marcador em vários runs
 *   (`{{nome_`, `fund`, `o}}`), então os runs do parágrafo são costurados: o valor vai no
 *   primeiro run do marcador (com a formatação dele) e os demais ficam vazios.
 * - Linha de tabela com `{{#lista}}` é replicada uma vez por item da lista; os marcadores da
 *   linha usam os campos do item (e, na falta, o contexto geral). Lista vazia some com a linha.
 * - `*_contabil` negativo (entre parênteses) sai em vermelho; o resto em preto.
 * - Marcador que nada resolveu é apagado no fim.
 */

export type Contexto = Record<string, string>;
export type Item = Record<string, unknown>;

const MARCADOR = /\{\{([#/]?)([a-zA-Z0-9_.]+)\}\}/g;

export class ModeloInvalido extends Error {}

// ---------------------------------------------------------------------------
// XML: achar elementos pelo nome, com aninhamento
// ---------------------------------------------------------------------------

type Faixa = { inicio: number; fim: number };

/** Faixas de todos os elementos `<tag>` do XML (inclusive aninhados), em ordem de abertura. */
function faixas(xml: string, tag: string): Faixa[] {
  const abre = new RegExp(`<${tag}(?=[\\s>/])[^>]*?(/?)>|</${tag}>`, 'g');
  const pilha: number[] = [];
  const saida: Faixa[] = [];
  for (let m = abre.exec(xml); m; m = abre.exec(xml)) {
    if (m[0].startsWith('</')) {
      const inicio = pilha.pop();
      if (inicio !== undefined) saida.push({ inicio, fim: m.index + m[0].length });
    } else if (m[1] === '/') {
      saida.push({ inicio: m.index, fim: m.index + m[0].length });
    } else {
      pilha.push(m.index);
    }
  }
  return saida.sort((a, b) => a.inicio - b.inicio);
}

const decodificar = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const codificar = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Texto visível de um trecho de XML (só os <w:t>). */
function textoDe(xml: string): string {
  let t = '';
  for (const m of xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:t(?:\s[^>]*)?\/>/g)) t += decodificar(m[1] ?? '');
  return t;
}

// ---------------------------------------------------------------------------
// Runs de um parágrafo
// ---------------------------------------------------------------------------

type Run = { xml: string; texto: string; mudou: boolean; cor: string | null };

/** Runs diretos do parágrafo (não entra em parágrafos aninhados de caixas de texto). */
function runsDoParagrafo(p: string): { partes: (string | Run)[]; runs: Run[] } {
  const partes: (string | Run)[] = [];
  const runs: Run[] = [];
  let pos = 0;
  for (const f of faixas(p, 'w:r')) {
    if (f.inicio < pos) continue; // run dentro de outro run (raro)
    const xml = p.slice(f.inicio, f.fim);
    if (/<w:p[\s>]/.test(xml)) continue;
    partes.push(p.slice(pos, f.inicio));
    const run: Run = { xml, texto: textoDe(xml), mudou: false, cor: null };
    partes.push(run);
    runs.push(run);
    pos = f.fim;
  }
  partes.push(p.slice(pos));
  return { partes, runs };
}

/** Reescreve o texto do run: um <w:t> só, com quebras de linha viradas em <w:br/>. */
function reescreverRun(r: Run): string {
  let xml = r.xml;
  if (r.cor) {
    if (/<w:rPr>|<w:rPr\s/.test(xml)) {
      xml = /<w:color\s[^>]*\/>/.test(xml)
        ? xml.replace(/<w:color\s[^>]*\/>/, `<w:color w:val="${r.cor}"/>`)
        : xml.replace(/(<w:rPr(?:\s[^>]*)?>)/, `$1<w:color w:val="${r.cor}"/>`);
    } else {
      xml = xml.replace(/^(<w:r(?:\s[^>]*)?>)/, `$1<w:rPr><w:color w:val="${r.cor}"/></w:rPr>`);
    }
  }
  if (!r.mudou) return xml;
  const linhas = r.texto.split(/\r?\n/);
  const novo = linhas.map((l, i) => `${i ? '<w:br/>' : ''}<w:t xml:space="preserve">${codificar(l)}</w:t>`).join('');
  let colocado = false;
  // Troca o primeiro <w:t> pelo texto novo e apaga os outros (e as quebras/tabs entre eles).
  xml = xml.replace(/<w:t(?:\s[^>]*)?>[\s\S]*?<\/w:t>|<w:t(?:\s[^>]*)?\/>/g, () => {
    if (colocado) return '';
    colocado = true;
    return novo;
  });
  if (!colocado) xml = xml.replace(/<\/w:r>$/, `${novo}</w:r>`);
  return xml;
}

/**
 * Troca os marcadores do parágrafo pelo `resolver` (undefined = deixa como está),
 * costurando os runs. `colorir`: *_contabil negativo em vermelho.
 */
function substituirNoParagrafo(p: string, resolver: (chave: string) => string | undefined, colorir = true): string {
  if (!p.includes('{')) return p;
  const { partes, runs } = runsDoParagrafo(p);
  if (!runs.length) return p;
  const completo = () => runs.map((r) => r.texto).join('');
  let texto = completo();
  if (!texto.includes('{{')) return p;
  let algum = false;
  const achados = [...texto.matchAll(MARCADOR)].reverse();
  for (const m of achados) {
    const chave = m[1] + m[2];
    const valor = resolver(chave);
    if (valor === undefined) continue;
    algum = true;
    texto = completo();
    // Limites de cada run no texto completo (recalculados a cada troca).
    const limites: [number, number][] = [];
    let pos = 0;
    for (const r of runs) { limites.push([pos, pos + r.texto.length]); pos += r.texto.length; }
    const inicio = m.index!;
    const fim = inicio + m[0].length;
    const indices = limites.map((l, i) => (l[0] < fim && l[1] > inicio ? i : -1)).filter((i) => i >= 0);
    if (!indices.length) continue;
    const primeiro = indices[0];
    const ultimo = indices[indices.length - 1];
    const prefixo = runs[primeiro].texto.slice(0, inicio - limites[primeiro][0]);
    const sufixo = limites[ultimo][1] >= fim ? runs[ultimo].texto.slice(fim - limites[ultimo][0]) : '';
    runs[primeiro].texto = prefixo + valor + (primeiro === ultimo ? sufixo : '');
    runs[primeiro].mudou = true;
    if (colorir && chave.endsWith('_contabil')) runs[primeiro].cor = valor.startsWith('(') ? 'FF0000' : '000000';
    for (const i of indices.slice(1)) {
      runs[i].texto = i === ultimo ? sufixo : '';
      runs[i].mudou = true;
    }
  }
  if (!algum) return p;
  return partes.map((x) => (typeof x === 'string' ? x : reescreverRun(x))).join('');
}

/** Aplica `fn` em cada parágrafo "folha" (sem parágrafo dentro) do trecho. */
function emCadaParagrafo(xml: string, fn: (p: string) => string): string {
  const folhas = faixas(xml, 'w:p').filter((f, _i, todas) => !todas.some((o) => o !== f && o.inicio > f.inicio && o.fim < f.fim));
  let saida = '';
  let pos = 0;
  for (const f of folhas) {
    if (f.inicio < pos) continue;
    saida += xml.slice(pos, f.inicio) + fn(xml.slice(f.inicio, f.fim));
    pos = f.fim;
  }
  return saida + xml.slice(pos);
}

// ---------------------------------------------------------------------------
// Tabelas com {{#lista}}
// ---------------------------------------------------------------------------

/** Tira a borda de baixo das células (linhas do meio da lista, como no Bate Lastro). */
function semBordaDeBaixo(tr: string): string {
  return tr.replace(/<w:tcBorders>([\s\S]*?)<\/w:tcBorders>/g, (_m, dentro: string) =>
    `<w:tcBorders>${dentro.replace(/<w:bottom\s[^>]*\/>/, (b) => b.replace(/w:val="[^"]*"/, 'w:val="nil"'))}</w:tcBorders>`);
}

function expandirListas(xml: string, listas: Record<string, Contexto[]>, contexto: Contexto): string {
  // Repete enquanto houver linha-modelo; começa pelas mais internas.
  for (let guarda = 0; guarda < 500; guarda++) {
    const linhas = faixas(xml, 'w:tr');
    const alvo = linhas.find((f) => {
      const trecho = xml.slice(f.inicio, f.fim);
      return /\{\{#[a-zA-Z0-9_]+\}\}/.test(textoDe(trecho)) && !linhas.some((o) => o !== f && o.inicio > f.inicio && o.fim < f.fim);
    });
    if (!alvo) return xml;
    let modelo = xml.slice(alvo.inicio, alvo.fim);
    const nome = /\{\{#([a-zA-Z0-9_]+)\}\}/.exec(textoDe(modelo))![1];
    // Costura os marcadores da linha-modelo (cada um num run) e tira os de bloco.
    modelo = emCadaParagrafo(modelo, (p) => substituirNoParagrafo(p, (chave) => (chave.startsWith('#') || chave.startsWith('/') ? '' : `{{${chave}}}`), false));
    const itens = listas[nome] ?? [];
    const meio = semBordaDeBaixo(modelo);
    const copias = itens.map((item, i) => {
      const base = i < itens.length - 1 ? meio : modelo;
      return emCadaParagrafo(base, (p) => substituirNoParagrafo(p, (chave) => item[chave] ?? contexto[chave]));
    });
    xml = xml.slice(0, alvo.inicio) + copias.join('') + xml.slice(alvo.fim);
  }
  return xml;
}

// ---------------------------------------------------------------------------
// Documento
// ---------------------------------------------------------------------------

const PARTES = /^word\/(document|header\d*|footer\d*)\.xml$/;

/** Marcadores presentes no modelo (para saber o roteiro do CVM). */
export async function marcadoresDoModelo(modelo: Uint8Array): Promise<string[]> {
  const zip = await abrir(modelo);
  const achados = new Set<string>();
  for (const nome of Object.keys(zip.files).filter((n) => PARTES.test(n))) {
    const xml = await zip.file(nome)!.async('string');
    emCadaParagrafo(xml, (p) => {
      for (const m of textoDe(p).matchAll(MARCADOR)) achados.add(m[1] + m[2]);
      return p;
    });
  }
  return [...achados];
}

async function abrir(modelo: Uint8Array): Promise<JSZip> {
  try {
    const zip = await JSZip.loadAsync(modelo);
    if (!zip.file('word/document.xml')) throw new Error('sem document.xml');
    return zip;
  } catch {
    throw new ModeloInvalido('Não foi possível abrir o modelo. Ele precisa ser um arquivo .docx válido.');
  }
}

export async function renderizar(modelo: Uint8Array, contexto: Contexto, listas: Record<string, Contexto[]>): Promise<Uint8Array> {
  const zip = await abrir(modelo);
  for (const nome of Object.keys(zip.files).filter((n) => PARTES.test(n))) {
    let xml = await zip.file(nome)!.async('string');
    xml = expandirListas(xml, listas, contexto);
    xml = emCadaParagrafo(xml, (p) => substituirNoParagrafo(p, (chave) => (chave.startsWith('#') || chave.startsWith('/') ? '' : contexto[chave])));
    // Sobras: marcador que nada resolveu sai do documento.
    xml = emCadaParagrafo(xml, (p) => substituirNoParagrafo(p, () => '', false));
    zip.file(nome, xml);
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
