import { ErroDeUso } from '@/lib/api';
import type { Arquivo } from './leitura';

/** Leitura dos campos multipart das rotas de amostragem. */

// O Bate Lastro recusa acima de 250 MB (limite do nginx); aqui é o mesmo teto.
const MAX_BYTES_ENVIO = 250 * 1024 * 1024;
const EXTENSOES = ['.csv', '.xlsx'];

export async function arquivosDo(form: FormData, campo: string, total = { bytes: 0 }): Promise<Arquivo[]> {
  const saida: Arquivo[] = [];
  for (const v of form.getAll(campo)) {
    if (!(v instanceof File) || !v.name) continue;
    if (!EXTENSOES.some((e) => v.name.toLowerCase().endsWith(e))) throw new ErroDeUso(`${v.name}: envie somente arquivos CSV ou XLSX.`, 422);
    total.bytes += v.size;
    if (total.bytes > MAX_BYTES_ENVIO) throw new ErroDeUso('Os arquivos passam de 250 MB. Envie o estoque em menos partes ou compactado em XLSX.', 413);
    saida.push({ nome: v.name, conteudo: new Uint8Array(await v.arrayBuffer()) });
  }
  return saida;
}

export function textoDo(form: FormData, campo: string): string | null {
  const v = form.get(campo);
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function inteiroDo(form: FormData, campo: string, padrao: number | null = null): number | null {
  const v = textoDo(form, campo);
  if (v === null) return padrao;
  if (!/^\d+$/.test(v)) throw new ErroDeUso('Os limites de adquiridos e vencidos devem ser inteiros não negativos.');
  return Number(v);
}

export function dataDo(form: FormData, campo: string, rotulo: string, obrigatoria = true): string | null {
  const v = textoDo(form, campo);
  if (!v) {
    if (obrigatoria) throw new ErroDeUso(`Informe a ${rotulo}.`);
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new ErroDeUso(`A ${rotulo} precisa estar no formato AAAA-MM-DD.`);
  return v;
}

export function regraDo(form: FormData): 'padrao' | 'planner' {
  const v = textoDo(form, 'regra') ?? 'padrao';
  if (v !== 'padrao' && v !== 'planner') throw new ErroDeUso('Regra de amostra desconhecida: use Padrão ou Planner.');
  return v;
}

export function idDaRota(texto: string): number {
  const id = Number(texto);
  if (!Number.isInteger(id) || id <= 0) throw new ErroDeUso('Amostra não encontrada.', 404);
  return id;
}
