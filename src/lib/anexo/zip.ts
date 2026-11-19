import JSZip from 'jszip';
import {
  caminhoRelativo, extensao, EXTENSOES_DOCUMENTO, MAX_BYTES_ARQUIVO, MAX_BYTES_LOTE, MAX_DOCUMENTOS, MAX_ENTRADAS_ZIP, RAZAO_MAXIMA_COMPRESSAO,
} from './caminhos';

/**
 * Abertura de ZIP no servidor (anexo_service.expandir_arquivo do Bate Lastro): cada arquivo
 * aceito entra com o caminho de dentro do ZIP. Limites: 2.000 entradas, 50 MB por arquivo,
 * 250 MB no total, 500 documentos, compressão até 200×; sem criptografia nem links;
 * __MACOSX e formatos não aceitos são ignorados.
 */

export class ZipRecusado extends Error {}

export type EntradaZip = { caminho: string; origem: string; bytes: Uint8Array };

type DadosInternos = { _data?: { compressedSize?: number; uncompressedSize?: number } };

async function abrir(bytes: Uint8Array): Promise<JSZip> {
  try {
    return await JSZip.loadAsync(bytes, { checkCRC32: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (/encrypt/i.test(msg)) throw new ZipRecusado('ZIP com links ou arquivos criptografados não é suportado');
    throw new ZipRecusado('ZIP inválido ou corrompido');
  }
}

/** Lista e (com `ler`) extrai os documentos de um ZIP. */
export async function expandirZip(bytes: Uint8Array, nomeZip: string, opcoes: { ler?: boolean } = {}): Promise<EntradaZip[]> {
  const zip = await abrir(bytes);
  const entradas = Object.values(zip.files);
  if (entradas.length > MAX_ENTRADAS_ZIP) throw new ZipRecusado('ZIP contém entradas demais');
  const resultado: EntradaZip[] = [];
  let total = 0;
  for (const entrada of entradas) {
    if (entrada.dir) continue;
    let nome: string;
    try {
      nome = caminhoRelativo(entrada.name);
    } catch {
      throw new ZipRecusado(`Caminho inválido dentro do ZIP: ${entrada.name}`);
    }
    const permissoes = entrada.unixPermissions;
    if (typeof permissoes === 'number' && (permissoes & 0o170000) === 0o120000) {
      throw new ZipRecusado('ZIP com links ou arquivos criptografados não é suportado');
    }
    if (nome.startsWith('__MACOSX/') || !EXTENSOES_DOCUMENTO.includes(extensao(nome))) continue;
    const dados = (entrada as unknown as DadosInternos)._data ?? {};
    const tamanho = dados.uncompressedSize ?? 0;
    const comprimido = dados.compressedSize ?? 0;
    total += tamanho;
    if (tamanho > MAX_BYTES_ARQUIVO || total > MAX_BYTES_LOTE || resultado.length >= MAX_DOCUMENTOS
        || tamanho > Math.max(comprimido, 1) * RAZAO_MAXIMA_COMPRESSAO) {
      throw new ZipRecusado('ZIP excede os limites de tamanho, quantidade ou compressão');
    }
    let conteudo: Uint8Array = new Uint8Array(0);
    if (opcoes.ler) {
      try {
        conteudo = await entrada.async('uint8array');
      } catch {
        throw new ZipRecusado(`Não foi possível ler ${nome} no ZIP`);
      }
    }
    resultado.push({ caminho: nome, origem: `${nomeZip}!/${nome}`, bytes: conteudo });
  }
  return resultado;
}
