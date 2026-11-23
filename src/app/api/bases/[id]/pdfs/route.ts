import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { definirTipoPdf, listarPdfs, obterBase } from '@/lib/repo';
import { iniciarIndexacao, indexando, receberPdfs, type PdfRecebido } from '@/lib/indexacao';
import { lerFormulario } from '@/lib/envio';
import type { Lado } from '@/lib/campos';

// Na nuvem a indexação roda depois da resposta (after), dentro deste tempo.
export const maxDuration = 300;

export async function GET(_req: Request, ctx: RouteContext<'/api/bases/[id]/pdfs'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const pdfs = await listarPdfs(id);
    const naFila = pdfs.some((p) => p.status === 'pendente' || p.status === 'indexando');
    // Na nuvem, a rodada anterior pode ter parado pelo tempo: quem acompanha a base retoma.
    if (pdfs.some((p) => p.status === 'pendente')) await iniciarIndexacao(id);
    return Response.json({ pdfs, indexando: indexando(id) || naFila });
  });
}

/** Recebe PDFs (multipart, campo "arquivos"; "caminhos" com o caminho relativo de cada um). */
export async function POST(request: Request, ctx: RouteContext<'/api/bases/[id]/pdfs'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    if (!await obterBase(id)) throw new ErroDeUso('Base não encontrada.', 404);
    const form = await lerFormulario(request);
    const arquivos = form.getAll('arquivos').filter((a): a is File => a instanceof File);
    const caminhos = form.getAll('caminhos').map(String);
    const tipo = form.get('tipo');
    if (!arquivos.length) throw new ErroDeUso('Nenhum PDF enviado.');
    const recebidos: PdfRecebido[] = [];
    for (let i = 0; i < arquivos.length; i++) {
      const a = arquivos[i];
      recebidos.push({
        nome: a.name,
        caminhoRelativo: caminhos[i] || null,
        bytes: new Uint8Array(await a.arrayBuffer()),
        tipo: tipo === 'termo' || tipo === 'lastro' ? tipo : null,
      });
    }
    return Response.json(await receberPdfs(id, recebidos));
  });
}

/** Ajustes: { pdf_id, tipo: 'termo'|'lastro'|null } ou { reindexar: true }. */
export async function PATCH(request: Request, ctx: RouteContext<'/api/bases/[id]/pdfs'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const corpo = await lerJson<{ pdf_id?: number; tipo?: Lado | null; reindexar?: boolean }>(request);
    if (corpo.pdf_id !== undefined) await definirTipoPdf(id, corpo.pdf_id, corpo.tipo ?? null);
    if (corpo.reindexar) await iniciarIndexacao(id);
    return Response.json({ ok: true, indexando: indexando(id) });
  });
}
