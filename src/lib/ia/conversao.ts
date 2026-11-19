/**
 * Validadores dos campos lidos pela IA, portados dos `field_validator(mode='before')` dos
 * modelos Pydantic do Bate Lastro (backend/models/*.py, utils/currency_parser.py,
 * utils/parse_datas.py). Mesmas regras e mesmas mensagens: elas voltam para o Gemini na
 * tentativa seguinte ("Na tentativa anterior houve erro de validação: …").
 *
 * Datas saem como 'AAAA-MM-DD'; moeda como número (o modelo Pydantic guarda float).
 */

export class ErroDeValidacao extends Error {}

const INTEIRO = /^\s*[+-]?\d+\s*$/;

function inteiro(texto: string): number {
  if (!INTEIRO.test(texto)) throw new ErroDeValidacao(`invalid literal for int(): '${texto}'`);
  return Number(texto.trim());
}

function dataExiste(ano: number, mes: number, dia: number): boolean {
  const d = new Date(Date.UTC(ano, mes - 1, dia));
  return d.getUTCFullYear() === ano && d.getUTCMonth() === mes - 1 && d.getUTCDate() === dia;
}

const iso = (ano: number, mes: number, dia: number) =>
  `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

/** Ano mal lido pelo OCR no formato ISO (1225 → 2025), como no Bate Lastro. */
function corrigirAno(ano: number): number {
  if (ano >= 1900) return ano;
  const s = String(ano);
  if (s.length === 4 && s.startsWith('12')) return Number('20' + s.slice(2));
  if (ano < 100) return 2000 + ano;
  return 2020 + (ano % 10);
}

function tentarIso(valor: string): string | null {
  if (!valor.includes('-')) return null;
  const partes = valor.split('-');
  if (partes.length !== 3) return null;
  try {
    const ano = corrigirAno(inteiro(partes[0]));
    const mes = inteiro(partes[1]);
    const dia = inteiro(partes[2]);
    if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 1900 && ano <= 2100 && dataExiste(ano, mes, dia)) return iso(ano, mes, dia);
  } catch {
    // formato inválido: cai no erro abaixo
  }
  return null;
}

/**
 * parse_data_br_ou_iso: DD/MM/AAAA (ano com 2 dígitos vira 20AA) ou AAAA-MM-DD.
 * `aceitaNulo`: a versão do termoCessao.py, que deixa None passar (campos Optional[date]).
 */
export function dataBrOuIso(valor: unknown, opcoes: { aceitaNulo?: boolean } = {}): string | null {
  if (valor === null || valor === undefined) {
    if (opcoes.aceitaNulo) return null;
    throw new ErroDeValidacao('Data inválida, esperado string ou objeto date');
  }
  if (typeof valor !== 'string') throw new ErroDeValidacao('Data inválida, esperado string ou objeto date');
  const v = valor.trim();
  if (v.includes('/')) {
    const partes = v.split('/');
    if (partes.length === 3) {
      try {
        const dia = inteiro(partes[0]);
        const mes = inteiro(partes[1]);
        let ano = inteiro(partes[2]);
        if (ano < 100) ano = 2000 + ano;
        if (dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 1900 && ano <= 2100 && dataExiste(ano, mes, dia)) return iso(ano, mes, dia);
      } catch {
        // segue para o formato ISO
      }
    }
  }
  const r = tentarIso(v);
  if (r) return r;
  throw new ErroDeValidacao(`Data inválida '${v}', esperado formato DD/MM/YYYY ou AAAA-MM-DD`);
}

/**
 * Versão da duplicata.py e notaFiscalServico.py: sempre DD/MM/AAAA, mas se a data não existe
 * tenta trocar dia e mês (31/02 → erro; 12/25/2024 → 25/12/2024).
 */
export function dataBrasileiraComTroca(valor: unknown): string {
  if (typeof valor !== 'string') throw new ErroDeValidacao('Data inválida, esperado string ou objeto date');
  const v = valor.trim();
  if (v.includes('/')) {
    const partes = v.split('/');
    if (partes.length === 3) {
      let dia: number, mes: number, ano: number;
      try {
        dia = inteiro(partes[0]);
        mes = inteiro(partes[1]);
        ano = inteiro(partes[2]);
      } catch {
        dia = mes = ano = NaN;
      }
      if (!Number.isNaN(dia)) {
        if (ano < 100) ano = 2000 + ano;
        if (!(dia >= 1 && dia <= 31 && mes >= 1 && mes <= 12 && ano >= 1900 && ano <= 2100)) {
          if (!(mes >= 1 && mes <= 31 && dia >= 1 && dia <= 12 && ano >= 1900 && ano <= 2100)) {
            throw new ErroDeValidacao(`Data com valores fora dos limites válidos: ${v}`);
          }
        }
        if (mes >= 1 && mes <= 12 && dataExiste(ano, mes, dia)) return iso(ano, mes, dia);
        if (dia <= 12 && mes <= 31) {
          // strptime("{mes}/{dia}/{ano}", '%d/%m/%Y'): dia e mês trocados
          if (dataExiste(ano, dia, mes)) return iso(ano, dia, mes);
          throw new ErroDeValidacao(`Data inválida mesmo após tentativa de correção: ${v}`);
        }
        throw new ErroDeValidacao(`Data inválida: ${v}`);
      }
    }
  }
  const r = tentarIso(v);
  if (r) return r;
  throw new ErroDeValidacao(`Data inválida '${v}', esperado formato DD/MM/YYYY (brasileiro) ou AAAA-MM-DD`);
}

/**
 * parse_currency: detecta formato brasileiro (1.234,56), americano (1,234.56) e numérico.
 * Valor ilegível vira 0 (e o parse_positive_currency recusa).
 */
export function lerValorMonetario(valor: unknown): number {
  if (typeof valor === 'number') return valor;
  if (typeof valor !== 'string') return 0;
  let s = valor.trim().replace(/[R$\s"]/g, '');
  if (!s || ['nan', 'none', 'null'].includes(s.toLowerCase())) return 0;
  const virgula = s.includes(',');
  const ponto = s.includes('.');
  if (virgula && ponto) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (virgula) {
    const partes = s.split(',');
    s = partes.length === 2 && partes[1].length <= 2 ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (ponto) {
    const partes = s.split('.');
    if (!(partes.length === 2 && partes[1].length <= 2)) s = s.replace(/\./g, '');
  }
  // float() do Python: aceita só número decimal (com sinal e expoente).
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** parse_positive_currency: o valor tem que ser maior que zero. */
export function valorPositivo(valor: unknown, nomeCampo = 'valor'): number {
  const n = lerValorMonetario(valor);
  if (!(n > 0)) throw new ErroDeValidacao(`${nomeCampo} deve ser maior que zero`);
  return n;
}

/**
 * CPF/CNPJ "devidamente formatado com ./-". `opcional`: a versão `if value and not …`
 * (campos Optional), que deixa vazio/None passar.
 */
export function documentoFormatado(valor: unknown, opcoes: { opcional?: boolean; mensagem?: string } = {}): unknown {
  const mensagem = opcoes.mensagem ?? "CPF/CNPJ deve estar formatado com '.', '-' ou '/'";
  if (opcoes.opcional && (valor === null || valor === undefined || valor === '')) return valor;
  if (typeof valor !== 'string') throw new ErroDeValidacao('Input should be a valid string');
  if (!['.', '-', '/'].some((sep) => valor.includes(sep))) throw new ErroDeValidacao(mensagem);
  return valor;
}

/** Número inteiro (lax do Pydantic: aceita 3, 3.0 e "3"). */
export function lerInteiro(valor: unknown): number {
  if (typeof valor === 'number' && Number.isInteger(valor)) return valor;
  if (typeof valor === 'string' && INTEIRO.test(valor)) return Number(valor.trim());
  throw new ErroDeValidacao('Input should be a valid integer');
}

/** validate_qtd / validate_quantidade_parcelas. */
export function quantidadePositiva(valor: unknown): number {
  const n = lerInteiro(valor);
  if (n <= 0) throw new ErroDeValidacao('Quantidade de parcelas deve ser maior que zero');
  return n;
}

/** validate_numero. */
export function numeroParcela(valor: unknown): number {
  const n = lerInteiro(valor);
  if (n < 1) throw new ErroDeValidacao('Número da parcela deve ser pelo menos 1');
  return n;
}
