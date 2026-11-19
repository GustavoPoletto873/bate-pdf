import { ErroDeUso, responder } from '@/lib/api';
import { excluirBase, obterBase } from '@/lib/repo';

export const dynamic = 'force-dynamic';

/** Exclui a base inteira: títulos, PDFs (e os arquivos), leituras, bates e pré-bates. */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const { id } = await ctx.params;
    if (!obterBase(id)) throw new ErroDeUso('Base não encontrada. Atualize a lista.', 404);
    excluirBase(id);
    return Response.json({ ok: true });
  });
}
