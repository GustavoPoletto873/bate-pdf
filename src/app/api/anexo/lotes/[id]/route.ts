import { responder } from '@/lib/api';
import { obterLote } from '@/lib/anexo/lotes';
import { iniciarFila } from '@/lib/anexo/fila';

export const dynamic = 'force-dynamic';

/** Situação do lote: documentos (situação, tipo, motivo) e as leituras extraídas. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    await iniciarFila();
    const { id } = await ctx.params;
    return Response.json(await obterLote(id));
  });
}
