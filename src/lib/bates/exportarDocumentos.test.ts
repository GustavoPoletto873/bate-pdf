import { beforeAll, describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';

// Banco temporário; dados fictícios.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-docs-'));
let repo: typeof import('@/lib/repo');
let dbMod: typeof import('@/lib/db');
let exp: typeof import('./exportarDocumentos');

beforeAll(async () => {
  repo = await import('@/lib/repo');
  dbMod = await import('@/lib/db');
  exp = await import('./exportarDocumentos');
});

function pdfNaBase(baseId: string, nome: string, conteudo: string) {
  const bytes = new TextEncoder().encode(`%PDF-1.4 ${conteudo}`);
  const sha = createHash('sha256').update(bytes).digest('hex');
  mkdirSync(dbMod.pastaDePdfs(baseId), { recursive: true });
  writeFileSync(join(dbMod.pastaDePdfs(baseId), `${sha}.pdf`), bytes);
  return { ...repo.registrarPdf(baseId, { nome_arquivo: nome, caminho_relativo: `lote/${nome}`, sha256: sha, tamanho: bytes.length }), sha };
}

describe('Exportar documentos', () => {
  test('ZIP com os vinculados, índice e SHA256SUMS', async () => {
    const id = repo.criarBase({
      nome: 'Base docs', nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: '12345678000195', data_referencia: '2026-09-30', administradora: null,
      origem: 'amostra', arquivo_origem: 'a.xlsx', lados: ['lastro'],
      titulos: [{ linha_origem: 2, id_base_origem: null, numero_documento: '777', sacado_nome: 'JOAO DA SILVA', sacado_documento: '12345678909',
        cedente_nome: 'EMPRESA FICTICIA LTDA', cedente_documento: '11222333000181', valor_total: '10.00', valor_aquisicao: null, data_emissao: '2026-08-01',
        data_vencimento: '2026-10-10', data_aquisicao: null, nome_fundo: 'FIDC EXEMPLO', cnpj_fundo: '12345678000195', tipo_recebivel: 'DUPLICATA', chave_nfe: null, lados: {} }],
    });
    const usado = pdfNaBase(id, 'dup-777.pdf', 'duplicata 777');
    pdfNaBase(id, 'sobra.pdf', 'outro');
    const [p] = repo.listarPendencias(id);
    await expect(exp.exportarDocumentos(id, 'vinculados')).rejects.toThrow(/Nenhum documento vinculado/);

    const campos = ['numero_documento', 'sacado_nome', 'sacado_documento', 'cedente_nome', 'cedente_documento', 'valor_total', 'data_emissao', 'data_vencimento'] as const;
    repo.salvarMarcacoes(id, campos.map((campo) => ({ pendencia_id: p.pendencia_id, campo, valor: 'V' as const })));
    expect(repo.vincular(id, [{ pendencia_id: p.pendencia_id, pdf_id: usado.id, pagina: 1 }]).vinculados).toBe(1);

    const r = await exp.exportarDocumentos(id, 'vinculados');
    expect(r.nome).toMatch(/^documentos_auditoria_12345678000195_\d{8}_\d{4}\.zip$/);
    const zip = await JSZip.loadAsync(r.zip);
    expect(Object.keys(zip.files).sort()).toEqual(['00_INDICE_AUDITORIA.xlsx', 'DOCUMENTOS_LIDOS/', 'DOCUMENTOS_LIDOS/lote/', 'DOCUMENTOS_LIDOS/lote/dup-777.pdf', 'SHA256SUMS.txt'].sort());
    expect(await zip.file('SHA256SUMS.txt')!.async('string')).toBe(`${usado.sha}  DOCUMENTOS_LIDOS/lote/dup-777.pdf\n`);
    const livro = new ExcelJS.Workbook();
    await livro.xlsx.load((await zip.file('00_INDICE_AUDITORIA.xlsx')!.async('nodebuffer')) as never);
    expect(livro.getWorksheet('Vínculos')!.getRow(2).getCell(2).value).toBe('777');

    const todos = await JSZip.loadAsync((await exp.exportarDocumentos(id, 'todos')).zip);
    expect(todos.file('DOCUMENTOS_LIDOS/lote/sobra.pdf')).not.toBeNull();
  });
});
