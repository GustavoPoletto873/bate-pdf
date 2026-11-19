/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Teste diferencial: os mesmos casos FICTÍCIOS rodados no motor Python do Bate
 * Lastro (oráculo) e aqui. A saída tem que ser idêntica, campo a campo.
 *
 * __fixtures__/diferencial.json foi gerado pelo oráculo (ver README.md desta
 * pasta): cada caso traz a entrada e o `esperado` (pre_classificar +
 * nao_encontrado_vira_d do Python).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { preClassificar } from './index';
import { normalizarTexto } from './valores';

const caminho = fileURLToPath(new URL('./__fixtures__/diferencial.json', import.meta.url));
const casos: any[] = JSON.parse(readFileSync(caminho, 'utf8'));

const normalizar = (lista: any[] = []) => lista.map((p) => ({ pdf: p.pdf, pagina: p.pagina, texto_normalizado: normalizarTexto(p.texto) }));

export function rodarCaso(caso: any) {
  return preClassificar({
    pendencias: caso.pendencias,
    paginas: normalizar(caso.paginas),
    paginasExternas: normalizar(caso.paginas_externas),
    pdfsExternos: caso.pdfs_externos,
    tiposPdf: caso.tipos_pdf,
    pdfsComLeitura: caso.pdfs_com_leitura,
    pdfsComLastro: caso.pdfs_com_lastro,
    leituras: caso.leituras,
    regrasFundo: caso.regras_fundo,
    vinculos: caso.vinculos,
    origens: caso.origens,
  });
}

/** Primeiro caminho em que `a` e `b` diferem (pra mensagem do teste). */
export function primeiraDiferenca(a: any, b: any, caminhoAtual = '$'): string | null {
  if (a === b) return null;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') {
    return `${caminhoAtual}: ${JSON.stringify(a)} ≠ ${JSON.stringify(b)}`;
  }
  if (Array.isArray(a) !== Array.isArray(b)) return `${caminhoAtual}: array × objeto`;
  const chaves = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of chaves) {
    if (!(k in a)) return `${caminhoAtual}.${k}: ausente no TS (Python: ${JSON.stringify(b[k])?.slice(0, 200)})`;
    if (!(k in b)) return `${caminhoAtual}.${k}: ausente no Python (TS: ${JSON.stringify(a[k])?.slice(0, 200)})`;
    const d = primeiraDiferenca(a[k], b[k], `${caminhoAtual}.${k}`);
    if (d) return d;
  }
  return null;
}

describe('diferencial com o motor Python', () => {
  test.each(casos.map((c) => [c.nome, c]))('%s', (_nome, caso) => {
    const obtido = JSON.parse(JSON.stringify(rodarCaso(caso)));
    const diferenca = primeiraDiferenca(obtido, caso.esperado);
    expect(diferenca).toBeNull();
  });
});
