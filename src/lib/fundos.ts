import ExcelJS from 'exceljs';
import { db, transacao } from '@/lib/db';
import { ErroDeUso } from '@/lib/api';
import { lerAbas, textoDaCelula } from '@/lib/planilha/importar';
import { digitos as soDigitos, formatarCpfCnpj } from '@/lib/texto';

/**
 * Gestão › Fundos — porta de backend/services/Fund/investment_fund_service.py e
 * backend/routes/Fund/investment_fund.py do Bate Lastro.
 *
 * Diferenças da versão local: um usuário só (sem instituição, grupos ou papéis), o CNPJ é guardado
 * com os 14 dígitos (sem máscara) e o cadastro de administradoras é daqui mesmo (no Bate Lastro vem
 * da instituição, com uma administradora padrão; aqui o fundo pode ficar sem administradora).
 */

const agora = () => new Date().toISOString();

/** Tamanho máximo do gestor (GESTOR_MAX em models/Fund/schemas.py). */
export const GESTOR_MAX = 120;
export const NOME_ADMINISTRADORA_MAX = 120;

export type TipoFundo = 'FIDC' | 'FIC_FIDC';
export const TIPOS_FUNDO: TipoFundo[] = ['FIDC', 'FIC_FIDC'];

export type Administradora = { id: number; nome: string; total_fundos: number };

export type Fundo = {
  id: number;
  nome: string;
  /** 14 dígitos, sem máscara. */
  cnpj: string;
  tipo: TipoFundo;
  administradora_id: number | null;
  administradora_nome: string | null;
  gestor: string | null;
  criado_em: string;
  atualizado_em: string;
  /** Bases (Upload Base) ligadas ao fundo. */
  bases: number;
};

export type FiltroFundos = {
  busca?: string | null;
  /** Id da administradora; 0 = fundos sem administradora ("Não informado"); null/undefined = todas. */
  administradora?: number | null;
};

export type PaginaFundos = { itens: Fundo[]; total: number; pagina: number; por_pagina: number };

// ---------------------------------------------------------------------------
// Utilidades (as mesmas regras do Bate Lastro)
// ---------------------------------------------------------------------------

/** Dígito verificador do CNPJ (_dv_cnpj_ok). */
export function dvCnpjOk(digitos: string): boolean {
  if (!/^\d{14}$/.test(digitos) || new Set(digitos).size === 1) return false;
  const pesos = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  for (const [tamanho, p] of [[12, pesos], [13, [6, ...pesos]]] as const) {
    let soma = 0;
    for (let i = 0; i < tamanho; i++) soma += Number(digitos[i]) * p[i];
    const resto = soma % 11;
    if (digitos[tamanho] !== String(resto < 2 ? 0 : 11 - resto)) return false;
  }
  return true;
}

/** Sem caracteres de controle/invisíveis (Cc, Cf): servem para disfarçar texto (_texto_ou_nulo). */
export function textoOuNulo(valor: unknown): string | null {
  const t = String(valor ?? '').replace(/[\p{Cc}\p{Cf}]/gu, '').trim();
  return t || null;
}

/** Compara nomes de administradora sem diferenciar acento, caixa e espaços (_chave). */
export function chaveDeNome(texto: string): string {
  return texto.normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
}

/** Minúsculo e sem acento, para a busca por nome. */
function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

/** Cabeçalho da planilha (já normalizado) → campo (_ALIASES_COLUNAS). Os em inglês são do modelo antigo. */
const ALIASES_COLUNAS: Record<string, string> = {
  cnpj_do_fundo: 'cnpj',
  nome_do_fundo: 'name', nome: 'name', fundo: 'name',
  tipo: 'fund_type', tipo_do_fundo: 'fund_type', tipo_de_fundo: 'fund_type',
  administradora: 'administrador',
  gestora: 'gestor',
};

/** Nome da coluna da planilha de fundos → campo (_coluna). "Tipo (FIDC ou FIC FIDC)" vale como "Tipo". */
export function campoDaColuna(nome: unknown): string {
  let s = String(nome ?? '').normalize('NFKD').replace(/[^\x00-\x7f]/g, '').toLowerCase();
  s = s.replace(/\(.*?\)/g, '').trim();
  s = s.replace(/\s+/g, '_');
  return ALIASES_COLUNAS[s] ?? s;
}

const MSG_CIENTIFICA = 'CNPJ em notação científica (ex.: 1,12E+13): o Excel cortou dígitos. Formate a coluna como texto e digite o CNPJ de novo.';

/** "1.12223330001810E+13" → "11222333000181" (int(Decimal(...)) do Python: corta a parte decimal). */
function inteiroDaNotacaoCientifica(texto: string): string | null {
  const m = /^(\d*)(?:\.(\d*))?[eE]\+?(\d+)$/.exec(texto);
  if (!m) return null;
  const inteiro = m[1] ?? '';
  const frac = m[2] ?? '';
  const expoente = Number(m[3]);
  const todos = inteiro + frac;
  if (!todos) return null;
  const posicao = inteiro.length + expoente;
  const parteInteira = posicao >= todos.length ? todos + '0'.repeat(posicao - todos.length) : todos.slice(0, posicao);
  return BigInt(parteInteira || '0').toString();
}

/** CNPJ como veio na planilha → 14 dígitos, ou o motivo de a linha ser inválida (_cnpj_da_planilha). */
export function cnpjDaPlanilha(valor: string): { digitos: string; motivo?: undefined } | { digitos?: undefined; motivo: string } {
  let s = valor.trim().replace(/^'+/, '');
  // Número salvo como decimal pelo Excel: 1234567000195.0
  if (/^\d+[.,]0+$/.test(s)) s = s.split(/[.,]/)[0];
  const cientifica = /^([\d.,]+)[eE]\+?(\d+)$/.exec(s);
  if (cientifica) {
    // 1,12223E+13 perdeu dígitos; só dá para aproveitar se a mantissa tem os 14.
    if (cientifica[1].replace(/\D/g, '').replace(/^0+/, '').length < 14) return { motivo: MSG_CIENTIFICA };
    const inteiro = inteiroDaNotacaoCientifica(s.replaceAll(',', '.'));
    if (inteiro === null) return { motivo: MSG_CIENTIFICA };
    s = inteiro;
  }
  let digitos = s.replace(/\D/g, '');
  // O Excel guarda CNPJ como número e come os zeros à esquerda; só devolve os zeros quando o
  // dígito verificador confirma que era isso.
  if (digitos.length >= 11 && digitos.length < 14 && dvCnpjOk(digitos.padStart(14, '0'))) digitos = digitos.padStart(14, '0');
  if (digitos.length !== 14) return { motivo: 'CNPJ não tem 14 dígitos' };
  return { digitos };
}

/** A busca tem cara de CNPJ (só dígitos e máscara)? Senão "FIDC 2" casaria com quase todo CNPJ. */
export function digitosDeBuscaPorCnpj(busca: string): string | null {
  if (!/^[\d.\-/\s]+$/.test(busca)) return null;
  const d = soDigitos(busca);
  return d.length >= 2 ? d : null;
}

function normalizarTipo(tipo: unknown): TipoFundo | null {
  const t = String(tipo ?? '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  return (TIPOS_FUNDO as string[]).includes(t) ? (t as TipoFundo) : null;
}

// ---------------------------------------------------------------------------
// Administradoras
// ---------------------------------------------------------------------------

export function listarAdministradoras(): Administradora[] {
  return db().prepare(`SELECT a.id, a.nome,
      (SELECT COUNT(*) FROM fundos f WHERE f.administradora_id = a.id) AS total_fundos
    FROM administradoras a ORDER BY a.nome COLLATE NOCASE`).all() as Administradora[];
}

export function criarAdministradora(nome: unknown): Administradora {
  const limpo = textoOuNulo(nome);
  if (!limpo) throw new ErroDeUso('Informe o nome da administradora.');
  if (limpo.length > NOME_ADMINISTRADORA_MAX) throw new ErroDeUso(`O nome da administradora pode ter no máximo ${NOME_ADMINISTRADORA_MAX} caracteres.`);
  const chave = chaveDeNome(limpo);
  const existente = listarAdministradoras().find((a) => chaveDeNome(a.nome) === chave);
  if (existente) throw new ErroDeUso(`Já existe a administradora "${existente.nome}". Escolha-a na lista.`, 409);
  const r = db().prepare('INSERT INTO administradoras (nome, criado_em) VALUES (?, ?)').run(limpo, agora());
  return { id: Number(r.lastInsertRowid), nome: limpo, total_fundos: 0 };
}

export type DadosAdministradora = { id: number; nome: string; razao_social: string | null; endereco: string | null; endereco_complemento: string | null };

/** Razão social e endereço: o que os relatórios CVM/NIX imprimem da administradora. */
export function atualizarAdministradora(id: number, dados: { razao_social?: unknown; endereco?: unknown; endereco_complemento?: unknown }): DadosAdministradora {
  exigirAdministradora(id);
  const campo = (v: unknown) => {
    const t = textoOuNulo(v);
    if (t && t.length > 300) throw new ErroDeUso('Cada campo pode ter no máximo 300 caracteres.');
    return t;
  };
  db().prepare('UPDATE administradoras SET razao_social = ?, endereco = ?, endereco_complemento = ? WHERE id = ?')
    .run(campo(dados.razao_social), campo(dados.endereco), campo(dados.endereco_complemento), id);
  return db().prepare('SELECT id, nome, razao_social, endereco, endereco_complemento FROM administradoras WHERE id = ?').get(id) as DadosAdministradora;
}

function exigirAdministradora(id: number) {
  const ok = db().prepare('SELECT 1 FROM administradoras WHERE id = ?').get(id);
  if (!ok) throw new ErroDeUso('Administradora não encontrada. Atualize a página e escolha de novo.', 404);
}

// ---------------------------------------------------------------------------
// Fundos
// ---------------------------------------------------------------------------

const SELECT_FUNDO = `SELECT f.id, f.nome, f.cnpj, f.tipo, f.administradora_id, a.nome AS administradora_nome, f.gestor,
    f.criado_em, f.atualizado_em, (SELECT COUNT(*) FROM bases b WHERE b.fundo_id = f.id) AS bases
  FROM fundos f LEFT JOIN administradoras a ON a.id = f.administradora_id`;

const porNome = (a: Fundo, b: Fundo) => a.nome.localeCompare(b.nome, 'pt-BR', { sensitivity: 'base' }) || a.id - b.id;

/** Todos os fundos do filtro, por nome (busca sem acento; CNPJ com ou sem máscara). */
export function filtrarFundos(filtro: FiltroFundos = {}): Fundo[] {
  const todos = db().prepare(SELECT_FUNDO).all() as Fundo[];
  const busca = (filtro.busca ?? '').trim();
  const termo = semAcento(busca);
  const cnpj = busca ? digitosDeBuscaPorCnpj(busca) : null;
  return todos
    .filter((f) => {
      if (filtro.administradora === 0 && f.administradora_id !== null) return false;
      if (filtro.administradora && f.administradora_id !== filtro.administradora) return false;
      if (!termo) return true;
      return semAcento(f.nome).includes(termo) || (cnpj !== null && f.cnpj.includes(cnpj));
    })
    .sort(porNome);
}

export function listarFundos(filtro: FiltroFundos & { pagina?: number; por_pagina?: number } = {}): PaginaFundos {
  const porPagina = Math.min(200, Math.max(1, filtro.por_pagina ?? 20));
  const pagina = Math.max(1, filtro.pagina ?? 1);
  const todos = filtrarFundos(filtro);
  return { itens: todos.slice((pagina - 1) * porPagina, pagina * porPagina), total: todos.length, pagina, por_pagina: porPagina };
}

export function obterFundo(id: number): Fundo | null {
  return (db().prepare(`${SELECT_FUNDO} WHERE f.id = ?`).get(id) as Fundo | undefined) ?? null;
}

export function fundoPorCnpj(cnpj: string): Fundo | null {
  return (db().prepare(`${SELECT_FUNDO} WHERE f.cnpj = ?`).get(soDigitos(cnpj)) as Fundo | undefined) ?? null;
}

function validarGestor(gestor: unknown): string | null {
  const g = textoOuNulo(gestor);
  if (g && g.length > GESTOR_MAX) throw new ErroDeUso(`O gestor pode ter no máximo ${GESTOR_MAX} caracteres.`);
  return g;
}

export type DadosFundo = {
  nome: string;
  cnpj: string;
  tipo?: string | null;
  administradora_id?: number | null;
  gestor?: string | null;
};

export function criarFundo(dados: DadosFundo): Fundo {
  const nome = textoOuNulo(dados.nome);
  if (!nome) throw new ErroDeUso('Informe o nome do fundo.');
  const cnpj = soDigitos(dados.cnpj);
  if (cnpj.length !== 14) throw new ErroDeUso('O CNPJ precisa ter 14 dígitos.');
  if (!dvCnpjOk(cnpj)) throw new ErroDeUso('CNPJ inválido: o dígito verificador não confere. Confira a digitação.');
  const existente = fundoPorCnpj(cnpj);
  if (existente) throw new ErroDeUso(`Este CNPJ já está cadastrado (${existente.nome}).`, 409);
  const tipo = dados.tipo ? normalizarTipo(dados.tipo) : 'FIDC';
  if (!tipo) throw new ErroDeUso('Tipo de fundo inválido. Use FIDC ou FIC FIDC.');
  const administradora = dados.administradora_id ?? null;
  if (administradora !== null) exigirAdministradora(administradora);
  const gestor = validarGestor(dados.gestor);
  const ts = agora();
  const r = db().prepare(`INSERT INTO fundos (nome, cnpj, tipo, administradora_id, gestor, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(nome, cnpj, tipo, administradora, gestor, ts, ts);
  return obterFundo(Number(r.lastInsertRowid))!;
}

/**
 * Edita o fundo (update_name do Bate Lastro). O CNPJ não muda. Só os campos presentes mudam:
 * `administradora_id: null` deixa sem administradora e gestor vazio limpa o gestor.
 */
export function atualizarFundo(id: number, dados: Partial<Omit<DadosFundo, 'cnpj'>>): Fundo {
  const atual = obterFundo(id);
  if (!atual) throw new ErroDeUso('Fundo não encontrado. Atualize a lista.', 404);
  const sets: string[] = [];
  const valores: (string | number | null)[] = [];
  if ('nome' in dados) {
    const nome = textoOuNulo(dados.nome);
    if (!nome) throw new ErroDeUso('O nome do fundo não pode ficar vazio.');
    sets.push('nome = ?'); valores.push(nome);
  }
  if ('tipo' in dados) {
    const tipo = normalizarTipo(dados.tipo);
    if (!tipo) throw new ErroDeUso('Tipo de fundo inválido. Use FIDC ou FIC FIDC.');
    sets.push('tipo = ?'); valores.push(tipo);
  }
  if ('administradora_id' in dados) {
    const adm = dados.administradora_id ?? null;
    if (adm !== null) exigirAdministradora(adm);
    sets.push('administradora_id = ?'); valores.push(adm);
  }
  if ('gestor' in dados) {
    sets.push('gestor = ?'); valores.push(validarGestor(dados.gestor));
  }
  if (sets.length) db().prepare(`UPDATE fundos SET ${sets.join(', ')}, atualizado_em = ? WHERE id = ?`).run(...valores, agora(), id);
  return obterFundo(id)!;
}

/**
 * Aplica a mesma administradora e/ou gestor a vários fundos (atualizar_em_lote). Campo ausente
 * mantém o atual; gestor vazio limpa.
 */
export function atualizarEmLote(ids: number[], dados: { administradora_id?: number | null; gestor?: string | null }): number {
  const unicos = [...new Set(ids.map(Number).filter(Number.isInteger))];
  if (!unicos.length) throw new ErroDeUso('Selecione ao menos um fundo.');
  if (!('administradora_id' in dados) && !('gestor' in dados)) throw new ErroDeUso('Escolha a administradora ou o gestor a aplicar.');
  const c = db();
  const existentes = (c.prepare(`SELECT COUNT(*) n FROM fundos WHERE id IN (${unicos.map(() => '?').join(',')})`).get(...unicos) as { n: number }).n;
  if (existentes !== unicos.length) throw new ErroDeUso('Algum fundo selecionado não foi encontrado. Atualize a lista e tente de novo.', 404);
  const adm = 'administradora_id' in dados ? dados.administradora_id ?? null : undefined;
  if (adm) exigirAdministradora(adm);
  const gestor = 'gestor' in dados ? validarGestor(dados.gestor) : undefined;
  transacao(() => {
    const ts = agora();
    for (const id of unicos) {
      if (adm !== undefined) c.prepare('UPDATE fundos SET administradora_id = ?, atualizado_em = ? WHERE id = ?').run(adm, ts, id);
      if (gestor !== undefined) c.prepare('UPDATE fundos SET gestor = ?, atualizado_em = ? WHERE id = ?').run(gestor, ts, id);
    }
  });
  return unicos.length;
}

function contar(sql: string, ...params: (string | number)[]): number {
  try {
    return (db().prepare(sql).get(...params) as { n: number }).n;
  } catch {
    return 0; // tabela de outro módulo ainda não existe
  }
}

/** O que depende do fundo (para o aviso antes de excluir). */
export function usoDoFundo(id: number): { bases: number; amostragens: number } {
  return {
    bases: contar('SELECT COUNT(*) n FROM bases WHERE fundo_id = ?', id),
    amostragens: contar('SELECT COUNT(*) n FROM amostragens WHERE fundo_id = ?', id),
  };
}

/**
 * Exclui o fundo. As bases continuam funcionando (guardam nome e CNPJ do fundo); só perdem a
 * ligação com o cadastro (fundo_id = null). As amostras sorteadas do fundo vão junto.
 */
export function excluirFundo(id: number): void {
  if (!obterFundo(id)) throw new ErroDeUso('Fundo não encontrado. Atualize a lista.', 404);
  transacao(() => {
    db().prepare('UPDATE bases SET fundo_id = NULL WHERE fundo_id = ?').run(id);
    db().prepare('DELETE FROM fundos WHERE id = ?').run(id);
  });
}

// ---------------------------------------------------------------------------
// Importação em lote (create_all)
// ---------------------------------------------------------------------------

export type ItemImportacao = { linha: number; nome: string | null; cnpj: string | null };
export type AlteracaoImportacao = { campo: 'administradora' | 'gestor'; de: string; para: string };

export type ResultadoImportacaoFundos = {
  simulacao: boolean;
  inseridos: (ItemImportacao & { tipo: TipoFundo; administradora: string; gestor: string | null })[];
  atualizados: (ItemImportacao & { alteracoes: AlteracaoImportacao[] })[];
  duplicados: (ItemImportacao & { motivo: string })[];
  invalidos: (ItemImportacao & { motivo: string })[];
};

const NAO_INFORMADO = 'Não informado';

/**
 * Cadastra os fundos novos da planilha e atualiza administradora/gestor dos já cadastrados.
 * `simular` devolve o mesmo resultado sem gravar (a prévia da tela). Em fundo já cadastrado, nome e
 * tipo da planilha são ignorados, e administradora ou gestor vazios mantêm o valor atual.
 */
export async function importarFundos(conteudo: Uint8Array, nomeArquivo: string, simular: boolean): Promise<ResultadoImportacaoFundos> {
  const extensao = /\.[^.]+$/.exec(nomeArquivo.toLowerCase())?.[0] ?? '';
  if (extensao === '.xls') throw new ErroDeUso('Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx.');
  if (extensao !== '.csv' && extensao !== '.xlsx') throw new ErroDeUso('Formato de arquivo não suportado. Envie .xlsx ou .csv.');
  if (!conteudo.length || (extensao === '.csv' && !new TextDecoder().decode(conteudo).trim())) throw new ErroDeUso('A planilha está vazia.');

  const abas = await lerAbas(conteudo, nomeArquivo);
  // A pessoa pode reordenar as abas do modelo: os fundos ficam na aba "Fundos".
  const aba = abas.find((a) => campoDaColuna(a.nome) === 'fundos') ?? abas[0];
  const cabecalho = aba?.linhas[0] ?? [];
  const indice = new Map<string, number>();
  cabecalho.forEach((v, i) => {
    const campo = campoDaColuna(textoDaCelula(v) ?? '');
    if (campo && !indice.has(campo)) indice.set(campo, i);
  });
  if (!indice.has('cnpj')) {
    throw new ErroDeUso('Não encontrei a coluna CNPJ na primeira linha da planilha. Use o modelo: a linha 1 traz os nomes das colunas (CNPJ, Nome do fundo, Tipo, Administrador, Gestor).');
  }

  const nomeAdm = new Map<number, string>();
  const porChave = new Map<string, number>();
  const ambiguas = new Set<string>();
  for (const a of db().prepare('SELECT id, nome FROM administradoras ORDER BY id').all() as { id: number; nome: string }[]) {
    nomeAdm.set(a.id, a.nome);
    const chave = chaveDeNome(a.nome);
    if (porChave.has(chave)) ambiguas.add(chave);
    else porChave.set(chave, a.id);
  }
  const existentes = new Map<string, Fundo>();
  for (const f of (db().prepare(`${SELECT_FUNDO} ORDER BY f.id`).all() as Fundo[])) {
    if (!existentes.has(f.cnpj)) existentes.set(f.cnpj, f);
  }

  const resultado: ResultadoImportacaoFundos = { simulacao: simular, inseridos: [], atualizados: [], duplicados: [], invalidos: [] };
  const novos: { nome: string; cnpj: string; tipo: TipoFundo; administradora_id: number | null; gestor: string | null }[] = [];
  const mudancas: { id: number; administradora_id?: number; gestor?: string }[] = [];
  const vistos = new Set<string>();
  const celula = (linha: unknown[], campo: string) => {
    const i = indice.get(campo);
    return i === undefined ? null : textoDaCelula(linha[i]);
  };

  // linhas[0] é o cabeçalho (linha 1 do Excel): linhas[n] é a linha n + 1, a que a pessoa vê.
  for (let n = 1; n < aba.linhas.length; n++) {
    const linhaPlanilha = aba.linhas[n];
    const linha = n + 1;
    const nome = celula(linhaPlanilha, 'name');
    const cnpjCru = celula(linhaPlanilha, 'cnpj');
    const tipoCru = celula(linhaPlanilha, 'fund_type');
    const admCru = celula(linhaPlanilha, 'administrador');
    const gestor = textoOuNulo(celula(linhaPlanilha, 'gestor'));
    if (![nome, cnpjCru, tipoCru, admCru, gestor].some(Boolean)) continue;

    const invalido = (motivo: string) => resultado.invalidos.push({ linha, nome, cnpj: cnpjCru, motivo });
    if (!cnpjCru) { invalido('CNPJ vazio'); continue; }
    const lido = cnpjDaPlanilha(cnpjCru);
    if (lido.motivo !== undefined) { invalido(lido.motivo); continue; }
    const digitos = lido.digitos;
    if (vistos.has(digitos)) { invalido('CNPJ repetido na planilha; vale só a primeira linha'); continue; }
    vistos.add(digitos);
    const cnpj = formatarCpfCnpj(digitos);

    let administradoraId: number | null = null;
    if (admCru) {
      const chave = chaveDeNome(admCru);
      if (ambiguas.has(chave)) { invalido(`Administradora "${admCru}" corresponde a mais de um cadastro. Deixe só uma com esse nome em Gestão › Fundos.`); continue; }
      administradoraId = porChave.get(chave) ?? null;
      if (administradoraId === null) {
        invalido(`Administradora "${admCru}" não está cadastrada. Cadastre-a primeiro (em "Nova administradora", no cadastro individual) ou confira o nome na aba Administradores do modelo.`);
        continue;
      }
    }
    if (gestor && gestor.length > GESTOR_MAX) { invalido(`Gestor com mais de ${GESTOR_MAX} caracteres`); continue; }

    const fundo = existentes.get(digitos);
    if (fundo) {
      const alteracoes: AlteracaoImportacao[] = [];
      if (administradoraId !== null && administradoraId !== fundo.administradora_id) {
        alteracoes.push({
          campo: 'administradora',
          de: (fundo.administradora_id !== null ? nomeAdm.get(fundo.administradora_id) : null) ?? NAO_INFORMADO,
          para: nomeAdm.get(administradoraId)!,
        });
      }
      if (gestor && gestor !== fundo.gestor) alteracoes.push({ campo: 'gestor', de: fundo.gestor || NAO_INFORMADO, para: gestor });
      const item = { linha, nome: fundo.nome, cnpj };
      if (!alteracoes.length) { resultado.duplicados.push({ ...item, motivo: 'Já cadastrado, sem alteração' }); continue; }
      resultado.atualizados.push({ ...item, alteracoes });
      mudancas.push({ id: fundo.id, ...(administradoraId !== null ? { administradora_id: administradoraId } : {}), ...(gestor ? { gestor } : {}) });
      continue;
    }

    // Só fundo novo: o já cadastrado é achado pelo CNPJ, mesmo que o dele não feche.
    if (!dvCnpjOk(digitos)) { invalido('CNPJ inválido: o dígito verificador não confere. Confira a digitação.'); continue; }
    if (!nome) { invalido('Fundo não cadastrado: preencha o nome para cadastrá-lo'); continue; }
    const tipo = tipoCru ? normalizarTipo(tipoCru) : 'FIDC';
    if (!tipo) { invalido('Tipo de fundo inválido. Use FIDC ou FIC FIDC.'); continue; }
    resultado.inseridos.push({
      linha, nome, cnpj, tipo,
      administradora: (administradoraId !== null ? nomeAdm.get(administradoraId) : null) ?? NAO_INFORMADO,
      gestor,
    });
    novos.push({ nome, cnpj: digitos, tipo, administradora_id: administradoraId, gestor });
  }

  if (!simular && (novos.length || mudancas.length)) {
    const c = db();
    transacao(() => {
      const ts = agora();
      const inserir = c.prepare(`INSERT INTO fundos (nome, cnpj, tipo, administradora_id, gestor, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const f of novos) inserir.run(f.nome, f.cnpj, f.tipo, f.administradora_id, f.gestor, ts, ts);
      for (const m of mudancas) {
        if (m.administradora_id !== undefined) c.prepare('UPDATE fundos SET administradora_id = ?, atualizado_em = ? WHERE id = ?').run(m.administradora_id, ts, m.id);
        if (m.gestor !== undefined) c.prepare('UPDATE fundos SET gestor = ?, atualizado_em = ? WHERE id = ?').run(m.gestor, ts, m.id);
      }
    });
  }
  return resultado;
}

/** Cabeçalho do modelo (COLUNAS_MODELO do CadastroFundo.jsx). */
export const COLUNAS_MODELO_FUNDOS = ['CNPJ', 'Nome do fundo', 'Tipo', 'Administrador', 'Gestor'];
const LINHAS_MODELO = 2000;

/**
 * "Baixar modelo": aba Fundos (CNPJ como texto — como número o Excel come o zero à esquerda e
 * mostra 1,12E+13) e aba Administradores com os nomes exatos para copiar.
 */
export async function gerarModeloFundos(): Promise<Uint8Array> {
  const livro = new ExcelJS.Workbook();
  const fundos = livro.addWorksheet('Fundos');
  fundos.addRow(COLUNAS_MODELO_FUNDOS);
  fundos.getRow(1).font = { bold: true };
  fundos.columns = [{ width: 20 }, { width: 40 }, { width: 10 }, { width: 30 }, { width: 30 }];
  fundos.getColumn(1).numFmt = '@';
  for (let linha = 2; linha <= LINHAS_MODELO; linha++) fundos.getCell(`A${linha}`).numFmt = '@';
  const administradores = livro.addWorksheet('Administradores');
  administradores.addRow(['Administrador']);
  administradores.getRow(1).font = { bold: true };
  administradores.getColumn(1).width = 40;
  for (const a of listarAdministradoras()) administradores.addRow([a.nome]);
  return new Uint8Array(await livro.xlsx.writeBuffer() as ArrayBuffer);
}
