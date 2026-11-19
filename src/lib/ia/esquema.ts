import { ErroDeValidacao } from './conversao';

/**
 * Descrição de um modelo de extração no lugar do modelo Pydantic do Bate Lastro: de uma
 * definição só saem o JSON Schema enviado ao Gemini (como `model_json_schema()`, com os
 * nomes dos campos = os aliases do Pydantic) e a validação da resposta (como
 * `Modelo(**json)`), com as mesmas regras de obrigatoriedade, nulo e validadores.
 */

export type TipoCampo = 'texto' | 'numero' | 'inteiro' | 'data' | 'booleano' | 'lista';

export type Campo = {
  /** Nome no JSON (o alias do Pydantic: NU_DOCUMENTO, VALOR_NOMINAL…). */
  nome: string;
  tipo: TipoCampo;
  descricao?: string;
  /** Optional[...]: aceita null. */
  anulavel?: boolean;
  /** Field(...) sem default = obrigatório (padrão). Field(None, …) = pode faltar. */
  obrigatorio?: boolean;
  /** Itens de uma lista. */
  itens?: Modelo;
  /** field_validator(mode='before'): devolve o valor convertido ou lança ErroDeValidacao. */
  validar?: (valor: unknown) => unknown;
};

export type Modelo = {
  nome: string;
  campos: Campo[];
  /** model_validator(mode='after'): roda só se todos os campos passaram. */
  validarModelo?: (dados: Record<string, unknown>) => void;
};

/** Texto de descrição como no modelo Python, sem a indentação das aspas triplas. */
export function texto(bruto: string): string {
  return bruto.split('\n').map((l) => l.trim()).join('\n').trim();
}

function esquemaDoTipo(c: Campo): Record<string, unknown> {
  switch (c.tipo) {
    case 'texto': return { type: 'string' };
    case 'numero': return { type: 'number' };
    case 'inteiro': return { type: 'integer' };
    case 'data': return { type: 'string', format: 'date' };
    case 'booleano': return { type: 'boolean' };
    case 'lista': return { type: 'array', items: esquemaJson(c.itens!) };
  }
}

/** JSON Schema do modelo (responseJsonSchema do Gemini). */
export function esquemaJson(m: Modelo): Record<string, unknown> {
  const properties: Record<string, unknown> = {};
  for (const c of m.campos) {
    const base = esquemaDoTipo(c);
    const p: Record<string, unknown> = c.anulavel ? { anyOf: [base, { type: 'null' }] } : { ...base };
    if (c.descricao) p.description = c.descricao;
    properties[c.nome] = p;
  }
  return {
    type: 'object',
    title: m.nome,
    properties,
    required: m.campos.filter((c) => c.obrigatorio !== false).map((c) => c.nome),
  };
}

export type ResultadoValidacao<T = Record<string, unknown>> = { ok: true; valor: T } | { ok: false; erros: string[] };

const NOME_TIPO: Record<TipoCampo, string> = {
  texto: 'string', numero: 'number', inteiro: 'integer', data: 'date', booleano: 'boolean', lista: 'list',
};

function conferirTipo(c: Campo, v: unknown): unknown {
  if (v === null || v === undefined) {
    if (c.anulavel) return null;
    throw new ErroDeValidacao(`Input should be a valid ${NOME_TIPO[c.tipo]}`);
  }
  switch (c.tipo) {
    case 'texto':
      if (typeof v === 'string') return v;
      break;
    case 'numero':
      if (typeof v === 'number' && Number.isFinite(v)) return v;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
      break;
    case 'inteiro':
      if (typeof v === 'number' && Number.isInteger(v)) return v;
      if (typeof v === 'string' && /^\s*[+-]?\d+\s*$/.test(v)) return Number(v.trim());
      break;
    case 'data':
      if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
      break;
    case 'booleano':
      if (typeof v === 'boolean') return v;
      if (v === 'true' || v === 1) return true;
      if (v === 'false' || v === 0) return false;
      break;
    case 'lista':
      if (Array.isArray(v)) return v;
      break;
  }
  throw new ErroDeValidacao(`Input should be a valid ${NOME_TIPO[c.tipo]}`);
}

function validarEm(m: Modelo, json: unknown, local: string[], erros: string[]): Record<string, unknown> | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    erros.push(`Campo '${local.join(' -> ') || m.nome}': Input should be a valid dictionary`);
    return null;
  }
  const entrada = json as Record<string, unknown>;
  const saida: Record<string, unknown> = {};
  const antes = erros.length;
  for (const c of m.campos) {
    const caminho = [...local, c.nome];
    const rotulo = caminho.join(' -> ');
    if (!(c.nome in entrada)) {
      if (c.obrigatorio !== false) erros.push(`Campo '${rotulo}': Field required`);
      else saida[c.nome] = null;
      continue;
    }
    try {
      let v = c.validar ? c.validar(entrada[c.nome]) : entrada[c.nome];
      v = conferirTipo(c, v);
      if (c.tipo === 'lista' && Array.isArray(v)) {
        v = v.map((item, i) => validarEm(c.itens!, item, [...caminho, String(i)], erros));
      }
      saida[c.nome] = v;
    } catch (e) {
      if (!(e instanceof ErroDeValidacao)) throw e;
      erros.push(`Campo '${rotulo}': Value error, ${e.message}`);
    }
  }
  if (erros.length === antes && m.validarModelo) {
    try {
      m.validarModelo(saida);
    } catch (e) {
      if (!(e instanceof ErroDeValidacao)) throw e;
      erros.push(`Campo '${local.join(' -> ') || m.nome}': Value error, ${e.message}`);
    }
  }
  return saida;
}

/** Valida a resposta do Gemini contra o modelo (o `response_model(**json_data)` do Bate Lastro). */
export function validarModelo(m: Modelo, json: unknown): ResultadoValidacao {
  const erros: string[] = [];
  const valor = validarEm(m, json, [], erros);
  return erros.length || !valor ? { ok: false, erros } : { ok: true, valor };
}
