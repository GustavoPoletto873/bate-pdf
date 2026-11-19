/**
 * Regras puras do agrupamento do Anexo (services/anexo_paths.py e
 * frontend/src/pages/Anexo/agrupamentoLote.js do Bate Lastro). Módulo puro: roda no
 * servidor e no navegador (a prévia do lote é montada só com os caminhos).
 */

export const MAX_DOCUMENTOS = 500;
export const MAX_BYTES_ARQUIVO = 50 * 1024 * 1024;
export const MAX_BYTES_LOTE = 250 * 1024 * 1024;
export const MAX_ENTRADAS_ZIP = 2000;
export const RAZAO_MAXIMA_COMPRESSAO = 200;

/** Documentos aceitos (o ZIP é aberto e os de dentro entram com o caminho interno). */
export const EXTENSOES_DOCUMENTO = ['.pdf', '.xml', '.jpg', '.jpeg', '.png'];
export const EXTENSOES_ACEITAS = [...EXTENSOES_DOCUMENTO, '.zip'];

export function extensao(caminho: string): string {
  const nome = caminho.split('/').pop() ?? caminho;
  const i = nome.lastIndexOf('.');
  return i > 0 ? nome.slice(i).toLowerCase() : '';
}

export const nomeDoArquivo = (caminho: string) => caminho.split('/').pop() ?? caminho;

/** caminho_relativo: recusa caminho absoluto, '..', '.', vazio, ':' e caracteres de controle. */
export function caminhoRelativo(valor: string): string {
  const v = valor.replace(/\\/g, '/');
  const partes = v.split('/');
  const controle = /[\x00-\x1f]/.test(v);
  if (!v || v.length > 1024 || v.startsWith('/') || v.includes(':') || partes.some((p) => p === '' || p === '.' || p === '..') || controle) {
    throw new Error('Caminho relativo inválido');
  }
  return partes.join('/');
}

/** A pasta que contém o arquivo é a operação (raiz/000.296.826-65_300422131/CCB.pdf). */
export function operacaoPelaPastaDoArquivo(caminho: string): { nome: string; caminho: string } | null {
  const partes = caminhoRelativo(caminho).split('/').slice(0, -1);
  if (!partes.length) return null;
  return { nome: partes[partes.length - 1], caminho: partes.join('/') };
}

/** Chave da operação no lote: a pasta (agrupando) ou o próprio arquivo, sem diferenciar maiúsculas. */
export function chaveDaOperacao(caminho: string, agrupar: boolean): { chave: string; nome: string | null; pasta: string | null } | null {
  if (!agrupar) return { chave: caminho.toLowerCase(), nome: null, pasta: null };
  const op = operacaoPelaPastaDoArquivo(caminho);
  if (!op) return null;
  return { chave: op.caminho.toLowerCase(), nome: op.nome, pasta: op.caminho };
}

export type GrupoPrevia = { chave: string; nome: string; pasta: string; arquivos: string[] };

export type PreviaLote = {
  total_documentos: number;
  total_operacoes: number;
  documentos: { caminho: string; operacao: string | null; pasta_operacao: string | null }[];
  grupos: GrupoPrevia[];
  duplicados: string[];
  soltos: string[];
  excedeLimite: boolean;
};

/** montarPreview: espelha o montar_manifesto, só com os caminhos. */
export function montarPreview(caminhos: string[], agrupar: boolean): PreviaLote {
  const vistos = new Set<string>();
  const grupos = new Map<string, GrupoPrevia>();
  const documentos: PreviaLote['documentos'] = [];
  const duplicados: string[] = [];
  const soltos: string[] = [];
  for (const caminho of caminhos) {
    const chaveDoc = caminho.toLowerCase();
    if (vistos.has(chaveDoc)) { duplicados.push(caminho); continue; }
    vistos.add(chaveDoc);
    const partes = caminho.split('/');
    const pasta = agrupar && partes.length > 1 ? partes.slice(0, -1).join('/') : null;
    const operacao = pasta ? partes[partes.length - 2] : null;
    if (agrupar && !pasta) soltos.push(caminho);
    documentos.push({ caminho, operacao, pasta_operacao: pasta });
    if (pasta) {
      const chave = pasta.toLowerCase();
      if (!grupos.has(chave)) grupos.set(chave, { chave, nome: operacao!, pasta, arquivos: [] });
      grupos.get(chave)!.arquivos.push(partes[partes.length - 1]);
    }
  }
  return {
    total_documentos: documentos.length,
    total_operacoes: grupos.size,
    documentos,
    grupos: [...grupos.values()],
    duplicados,
    soltos,
    excedeLimite: documentos.length > MAX_DOCUMENTOS,
  };
}

/** Prévia que pode seguir: sem repetidos, sem soltos (agrupando) e dentro do limite. */
export const previaValida = (p: PreviaLote | null): p is PreviaLote =>
  !!p && p.total_documentos > 0 && !p.duplicados.length && !p.soltos.length && !p.excedeLimite;
