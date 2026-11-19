import ExcelJS from 'exceljs';
import { db } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';
import { CAMPOS, type CampoId, type Lado, type Veredito } from '@/lib/campos';
import { vereditoAutomatico, vereditoDoCampo, type LeituraCampos } from '@/lib/bates/comparacao';
import { inserirLeitura, tipoRecebivelDoLado, type LeituraLinha } from '@/lib/bates/leituras';
import { COLUNAS_TITULO, criarVinculoDeLeitura, tituloDaLinha, type TituloDaBase } from '@/lib/bates/preMatches';

/**
 * "Inserir Resultado" da Gestão de Bates (importar_resultado_matching_service.py): grava nesta
 * base um resultados_matching_*.xlsx revisado fora. Regras de lá:
 *
 * - STATUS V: o título fica batido naquele lado. Se já está, só os vereditos DIV_* da planilha
 *   substituem os atuais; se há pré-bate do documento de LEITURA_NUMERO_DOC (ou a coluna não
 *   existe), ele é confirmado; senão nasce uma leitura origem 'planilha' (sem PDF) com os
 *   LEITURA_* e um vínculo manual.
 * - Qualquer outro STATUS não mexe em nada: a planilha nunca desfaz um bate.
 * - O título é achado pelo ID_BASE (o id do Bate Lastro, guardado em titulos.id_base_origem);
 *   senão pelo nº do documento + valor nominal, desde que case com um título só.
 *
 * Prévia e gravação passam pelo mesmo código; a prévia termina em ROLLBACK.
 */

export const MAX_BYTES_PLANILHA = 20 * 1024 * 1024;
const ABAS: Record<string, Lado> = { TERMO: 'termo', LASTRO: 'lastro' };

const DIV_PARA_CAMPO: Record<string, CampoId> = Object.fromEntries(CAMPOS.map((c) => [c.colunaDiv, c.campo]));
const LEITURA_PARA_CAMPO: Record<string, { campo: CampoId; tipo: 'texto' | 'data' | 'valor'; limite?: number }> = {
  LEITURA_NUMERO_DOC: { campo: 'numero_documento', tipo: 'texto', limite: 100 },
  LEITURA_NOME_SACADO: { campo: 'sacado_nome', tipo: 'texto', limite: 255 },
  LEITURA_DOC_SACADO: { campo: 'sacado_documento', tipo: 'texto', limite: 50 },
  LEITURA_NOME_CEDENTE: { campo: 'cedente_nome', tipo: 'texto', limite: 255 },
  LEITURA_DOC_CEDENTE: { campo: 'cedente_documento', tipo: 'texto', limite: 50 },
  LEITURA_NOME_CESSIONARIO: { campo: 'nome_cessionario', tipo: 'texto', limite: 255 },
  LEITURA_DOC_CESSIONARIO: { campo: 'doc_cessionario', tipo: 'texto', limite: 50 },
  LEITURA_DATA_AQUISICAO: { campo: 'data_aquisicao', tipo: 'data' },
  LEITURA_VALOR_NOMINAL: { campo: 'valor_total', tipo: 'valor' },
  LEITURA_DATA_EMISSAO: { campo: 'data_emissao', tipo: 'data' },
  LEITURA_DATA_VENCIMENTO: { campo: 'data_vencimento', tipo: 'data' },
};

export const CASOS = ['bate_criado', 'pre_bate_confirmado', 'marcacoes_atualizadas', 'ja_batido_igual'] as const;
type Caso = (typeof CASOS)[number];

export type LinhaPlanilha = {
  aba: 'TERMO' | 'LASTRO';
  linha_excel: number;
  id_base: number | null;
  validado: boolean;
  numero_doc: string | null;
  valor_nominal: string | null;
  leitura: LeituraCampos;
  marcacoes: Partial<Record<CampoId, Veredito>>;
};

export type ResumoInsercao = {
  arquivo: string;
  simulado: boolean;
  por_aba: Record<'TERMO' | 'LASTRO', { validados: number; pendentes: number }>;
  casos: Record<Lado, Record<Caso, number>>;
  localizados_por_numero: number;
  nao_encontrados: { aba: string; linha: number; id_base: number | null; numero_documento: string | null; valor_nominal: number | null; motivo: string }[];
  total_a_gravar: number;
};

// ---------------------------------------------------------------------------
// Conversões (_texto, _valor, _data, _inteiro)
// ---------------------------------------------------------------------------

function celula(v: ExcelJS.CellValue): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as unknown as Record<string, unknown>;
    if ('result' in o) return celula(o.result as ExcelJS.CellValue);
    if ('richText' in o && Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((p) => p.text).join('');
    if ('text' in o) return o.text;
    return null;
  }
  return v;
}

export function texto(v: unknown, limite?: number): string | null {
  if (v === null || v === undefined) return null;
  const t = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
  if (!t) return null;
  return limite ? t.slice(0, limite) : t;
}

/** Quantiza em 2 casas com arredondamento bancário (Decimal.quantize), em texto. */
function quantizar(decimal: string): string | null {
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(decimal);
  if (!m || (!m[2] && !m[3])) return null;
  const inteiro = BigInt(m[2] || '0');
  const frac = (m[3] ?? '').padEnd(3, '0');
  let centavos = inteiro * 100n + BigInt(frac.slice(0, 2));
  const resto = frac.slice(2);
  const meio = resto[0] > '5' || (resto[0] === '5' && /[1-9]/.test(resto.slice(1)));
  const exato = resto[0] === '5' && !/[1-9]/.test(resto.slice(1));
  if (meio || (exato && centavos % 2n === 1n)) centavos += 1n;
  if (centavos === 0n) return null; // "A exportação escreve 0 quando o título não tem leitura."
  const s = centavos.toString().padStart(3, '0');
  return `${m[1]}${s.slice(0, -2)}.${s.slice(-2)}`;
}

export function valorDecimal(v: unknown): string | null {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    const s = String(v);
    return quantizar(/e/i.test(s) ? v.toFixed(10) : s);
  }
  let t = String(v).replace(/[R$\s]/g, '');
  if (!t) return null;
  // Ponto só é decimal sem vírgula e fora do padrão de milhar ("1.234" é mil e pouco).
  if (t.includes(',') || /^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '').replace(',', '.');
  if (!/^-?\d*(\.\d*)?$/.test(t)) return null;
  return quantizar(t);
}

export function dataIso(v: unknown): string | null {
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  const t = texto(v);
  if (!t) return null;
  const valida = (a: number, m: number, d: number) => {
    const x = new Date(Date.UTC(a, m - 1, d));
    return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? x.toISOString().slice(0, 10) : null;
  };
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?: \d{1,2}:\d{1,2}:\d{1,2})?$/.exec(t);
  if (m) return valida(Number(m[3]), Number(m[2]), Number(m[1]));
  m = /^(\d{4})-(\d{1,2})-(\d{1,2})(?: \d{1,2}:\d{1,2}:\d{1,2})?$/.exec(t);
  if (m) return valida(Number(m[1]), Number(m[2]), Number(m[3]));
  return null;
}

function inteiro(v: unknown): number | null {
  const t = texto(v);
  if (!t || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  return Math.trunc(Number(t));
}

/** _numero_normalizado: maiúsculas, sem espaços nas pontas e sem zeros à esquerda. */
export function numeroNormalizado(n: string | null | undefined): string {
  const t = String(n ?? '').trim().toUpperCase();
  return t.replace(/^0+/, '') || t;
}

function cnpj(v: unknown): string | null {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 14 ? d : null;
}

// ---------------------------------------------------------------------------
// Leitura da planilha (ler_planilha)
// ---------------------------------------------------------------------------

export async function lerPlanilhaResultado(conteudo: Uint8Array, nomeArquivo: string): Promise<{ linhas: LinhaPlanilha[]; cnpjs: Set<string> }> {
  const livro = new ExcelJS.Workbook();
  try {
    await livro.xlsx.load(conteudo.buffer.slice(conteudo.byteOffset, conteudo.byteOffset + conteudo.byteLength) as ArrayBuffer);
  } catch {
    throw new ErroDeUso('Não foi possível abrir o arquivo. Envie o .xlsx exportado em Resultados.', 422);
  }
  const cnpjs = new Set<string>();
  const doNome = /resultados_matching_(\d{14})_/.exec(nomeArquivo ?? '');
  if (doNome) cnpjs.add(doNome[1]);

  const abas = (Object.keys(ABAS) as ('TERMO' | 'LASTRO')[]).filter((a) => livro.getWorksheet(a));
  if (!abas.length) throw new ErroDeUso('A planilha não tem as abas TERMO e LASTRO do resultado matching.', 422);

  const linhas: LinhaPlanilha[] = [];
  for (const aba of abas) {
    const ws = livro.getWorksheet(aba)!;
    const valores: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => { valores[n - 1] = (row.values as ExcelJS.CellValue[]).slice(1).map(celula); });
    for (let i = 0; i < valores.length; i++) if (!valores[i]) valores[i] = [];
    // O cabeçalho fica abaixo do título "DADOS TERMO"/"DADOS LASTRO" (nas 10 primeiras linhas).
    let cab: Map<string, number> | null = null;
    let linhaCab = -1;
    for (let i = 0; i < Math.min(valores.length, 10); i++) {
      const nomes = valores[i].map((v) => texto(v));
      if (nomes.includes('ID_BASE')) {
        cab = new Map();
        nomes.forEach((nome, j) => { if (nome) cab!.set(nome, j); });
        linhaCab = i;
        break;
      }
    }
    if (!cab || !cab.has('STATUS')) throw new ErroDeUso(`A aba ${aba} não tem as colunas ID_BASE e STATUS.`, 422);
    const col = (linha: unknown[], nome: string) => {
      const i = cab!.get(nome);
      return i === undefined ? null : linha[i] ?? null;
    };
    for (let n = linhaCab + 1; n < valores.length; n++) {
      const v = valores[n];
      const idBase = inteiro(col(v, 'ID_BASE'));
      const numeroDoc = texto(col(v, 'BASE_NUMERO_DOC'));
      if (idBase === null && !numeroDoc) continue;
      const c = cnpj(col(v, 'BASE_CNPJ_FUNDO'));
      if (c) cnpjs.add(c);
      const linha: LinhaPlanilha = {
        aba, linha_excel: n + 1, id_base: idBase,
        validado: (texto(col(v, 'STATUS')) ?? '').toUpperCase() === 'V',
        numero_doc: numeroDoc, valor_nominal: valorDecimal(col(v, 'BASE_VALOR_NOMINAL')),
        leitura: {}, marcacoes: {},
      };
      for (const [coluna, def] of Object.entries(LEITURA_PARA_CAMPO)) {
        if (!cab.has(coluna)) continue;
        const bruto = col(v, coluna);
        const convertido = def.tipo === 'data' ? dataIso(bruto) : def.tipo === 'valor' ? valorDecimal(bruto) : texto(bruto, def.limite);
        if (convertido !== null) linha.leitura[def.campo] = convertido;
      }
      for (const [coluna, campo] of Object.entries(DIV_PARA_CAMPO)) {
        const veredito = (texto(col(v, coluna)) ?? '').toUpperCase();
        if (veredito === 'V' || veredito === 'D' || veredito === 'P') linha.marcacoes[campo] = veredito;
      }
      linhas.push(linha);
    }
  }
  return { linhas, cnpjs };
}

// ---------------------------------------------------------------------------
// Gravação (_processar)
// ---------------------------------------------------------------------------

type EstadoPendencia = {
  id: number;
  situacao: string;
  vinculo: { id: number; marcacoes: string; leitura: string } | null;
  pre_bate: { id: number; leitura_id: number; similaridade: number; leitura_numero: string | null } | null;
};

function processar(baseId: string, nomeArquivo: string, linhas: LinhaPlanilha[], cnpjs: Set<string>, gravar: boolean): ResumoInsercao {
  const c = db();
  const titulos = c.prepare(`SELECT ${COLUNAS_TITULO} FROM titulos t WHERE t.base_id = ? ORDER BY t.id`).all(baseId) as Record<string, unknown>[];
  if (!titulos.length) throw new ErroDeUso('Base não encontrada.', 404);
  const base = c.prepare('SELECT cnpj_fundo FROM bases WHERE id = ?').get(baseId) as { cnpj_fundo: string | null } | undefined;
  const cnpjsBase = new Set([...titulos.map((t) => String(t.t_cnpj_fundo ?? '')), base?.cnpj_fundo ?? '']
    .map((x) => x.replace(/\D/g, '')).filter((x) => x.length === 14));
  if (!cnpjs.size) {
    // Sem o fundo, a busca por nº + valor casaria títulos de outro fundo por coincidência.
    throw new ErroDeUso('Não foi possível identificar o fundo desta planilha. Use o arquivo exportado em Resultados sem renomear (o CNPJ vai no nome do arquivo).', 422);
  }
  if (cnpjsBase.size && ![...cnpjs].some((x) => cnpjsBase.has(x))) {
    throw new ErroDeUso('Esta planilha é de outro fundo (CNPJ diferente do da base aberta). Confira o arquivo.', 422);
  }

  const porAba = { TERMO: { validados: 0, pendentes: 0 }, LASTRO: { validados: 0, pendentes: 0 } };
  for (const l of linhas) porAba[l.aba][l.validado ? 'validados' : 'pendentes']++;

  // _localizar_titulos
  const lista = titulos.map(tituloDaLinha);
  const porIdBase = new Map<number, TituloDaBase>();
  for (const t of lista) if (t.id_base_origem !== null && !porIdBase.has(t.id_base_origem)) porIdBase.set(t.id_base_origem, t);
  const porNumeroValor = new Map<string, TituloDaBase[]>();
  for (const t of lista) {
    if (!t.numero_documento) continue;
    const k = `${numeroNormalizado(t.numero_documento)}|${valorDecimal(t.valor_total) ?? ''}`;
    porNumeroValor.set(k, [...(porNumeroValor.get(k) ?? []), t]);
  }
  const naoEncontrados: ResumoInsercao['nao_encontrados'] = [];
  let porNumero = 0;
  const unicas = new Map<string, { titulo: TituloDaBase; linha: LinhaPlanilha }>();
  for (const linha of linhas.filter((l) => l.validado)) {
    let titulo = linha.id_base !== null ? porIdBase.get(linha.id_base) : undefined;
    if (!titulo) {
      const achados = linha.numero_doc ? porNumeroValor.get(`${numeroNormalizado(linha.numero_doc)}|${linha.valor_nominal ?? ''}`) ?? [] : [];
      if (achados.length === 1) { titulo = achados[0]; porNumero++; }
      else {
        naoEncontrados.push({
          aba: linha.aba, linha: linha.linha_excel, id_base: linha.id_base, numero_documento: linha.numero_doc,
          valor_nominal: linha.valor_nominal === null ? null : Number(linha.valor_nominal),
          motivo: achados.length > 1 ? 'mais de um título com esse número e valor' : 'título não está nesta base',
        });
        continue;
      }
    }
    // Mesmo título repetido na planilha: vale a última linha.
    unicas.set(`${titulo.id}|${ABAS[linha.aba]}`, { titulo, linha });
  }

  const casos: ResumoInsercao['casos'] = {
    termo: Object.fromEntries(CASOS.map((k) => [k, 0])) as Record<Caso, number>,
    lastro: Object.fromEntries(CASOS.map((k) => [k, 0])) as Record<Caso, number>,
  };
  const estado = c.prepare(`SELECT p.id, p.situacao,
      v.id AS v_id, v.marcacoes AS v_marcacoes, v.leitura AS v_leitura,
      pm.id AS pm_id, pm.leitura_id AS pm_leitura_id, pm.similaridade AS pm_similaridade, l.numero_documento AS pm_numero
    FROM pendencias p LEFT JOIN vinculos v ON v.pendencia_id = p.id
    LEFT JOIN pre_matches pm ON pm.pendencia_id = p.id LEFT JOIN leituras l ON l.id = pm.leitura_id
    WHERE p.titulo_id = ? AND p.lado = ?`);
  const ts = new Date().toISOString();

  for (const { titulo, linha } of [...unicas.values()].sort((a, b) => a.titulo.id - b.titulo.id)) {
    const lado = ABAS[linha.aba];
    const contagem = casos[lado];
    const r = estado.get(titulo.id, lado) as Record<string, unknown> | undefined;
    const e: EstadoPendencia | null = r ? {
      id: r.id as number, situacao: r.situacao as string,
      vinculo: r.v_id ? { id: r.v_id as number, marcacoes: r.v_marcacoes as string, leitura: r.v_leitura as string } : null,
      pre_bate: r.pm_id ? { id: r.pm_id as number, leitura_id: r.pm_leitura_id as number, similaridade: r.pm_similaridade as number, leitura_numero: r.pm_numero as string | null } : null,
    } : null;

    if (e?.vinculo) {
      // Já batido: só os vereditos DIV_* da planilha substituem os atuais (salvo, senão a comparação).
      const salvas = JSON.parse(e.vinculo.marcacoes) as Partial<Record<CampoId, Veredito>>;
      const leitura = JSON.parse(e.vinculo.leitura) as LeituraCampos;
      const mudou = (Object.entries(linha.marcacoes) as [CampoId, Veredito][])
        .some(([campo, v]) => vereditoDoCampo(salvas, campo, vereditoAutomatico(campo, titulo, leitura)) !== v);
      if (mudou) {
        contagem.marcacoes_atualizadas++;
        if (gravar) c.prepare('UPDATE vinculos SET marcacoes = ? WHERE id = ?').run(JSON.stringify({ ...salvas, ...linha.marcacoes }), e.vinculo.id);
      } else contagem.ja_batido_igual++;
      continue;
    }
    if (e?.situacao === 'ja_batido') {
      // Veio batido do Bate Lastro: aqui não há vínculo onde guardar vereditos.
      contagem.ja_batido_igual++;
      continue;
    }
    // _escolher_pre_bate: o revisor conferiu o documento de LEITURA_NUMERO_DOC.
    const numero = numeroNormalizado(linha.leitura.numero_documento);
    const escolhido = e?.pre_bate && (!numero || numeroNormalizado(e.pre_bate.leitura_numero) === numero) ? e.pre_bate : null;
    if (e && escolhido) {
      contagem.pre_bate_confirmado++;
      if (gravar) {
        const leitura = c.prepare('SELECT * FROM leituras WHERE id = ?').get(escolhido.leitura_id) as LeituraLinha;
        criarVinculoDeLeitura(baseId, {
          pendencia_id: e.id, lado, titulo, leitura, tipo_match: 'automatico', origem: 'pre_bate',
          similaridade: escolhido.similaridade, salvas: linha.marcacoes, ts,
        });
      }
      continue;
    }
    contagem.bate_criado++;
    if (!gravar) continue;
    // Pré-bate de outro documento: descartado (a leitura volta a ficar livre).
    let pendenciaId = e?.id;
    if (pendenciaId === undefined) {
      // Título que não tinha este lado para conferir nesta base.
      pendenciaId = Number(c.prepare("INSERT INTO pendencias (base_id, titulo_id, lado, situacao) VALUES (?, ?, ?, 'pendente')").run(baseId, titulo.id, lado).lastInsertRowid);
    }
    const leituraId = inserirLeitura(c, {
      base_id: baseId, pdf_id: null, tipo_recebivel: tipoRecebivelDoLado(lado, titulo.tipo_recebivel),
      origem: 'planilha', campos: linha.leitura, lida_em: ts,
    });
    const leitura = c.prepare('SELECT * FROM leituras WHERE id = ?').get(leituraId) as LeituraLinha;
    criarVinculoDeLeitura(baseId, {
      pendencia_id: pendenciaId, lado, titulo, leitura, tipo_match: 'manual', origem: 'planilha',
      similaridade: null, salvas: linha.marcacoes, ts,
    });
  }
  if (gravar) c.prepare('UPDATE bases SET atualizado_em = ? WHERE id = ?').run(ts, baseId);

  return {
    arquivo: nomeArquivo,
    simulado: !gravar,
    por_aba: porAba,
    casos,
    localizados_por_numero: porNumero,
    nao_encontrados: naoEncontrados,
    total_a_gravar: (['termo', 'lastro'] as Lado[]).reduce((s, l) => s + casos[l].bate_criado + casos[l].pre_bate_confirmado + casos[l].marcacoes_atualizadas, 0),
  };
}

/** Lê a planilha e grava (ou só simula: a prévia passa pelo mesmo código e desfaz no fim). */
export async function inserirResultado(baseId: string, conteudo: Uint8Array, nomeArquivo: string, simular: boolean): Promise<ResumoInsercao> {
  const { linhas, cnpjs } = await lerPlanilhaResultado(conteudo, nomeArquivo);
  if (!linhas.length) throw new ErroDeUso('A planilha não tem nenhum título.', 422);
  const c = db();
  c.exec('BEGIN IMMEDIATE');
  try {
    const resumo = processar(baseId, nomeArquivo, linhas, cnpjs, !simular);
    c.exec(simular ? 'ROLLBACK' : 'COMMIT');
    return resumo;
  } catch (e) {
    c.exec('ROLLBACK');
    throw e;
  }
}
