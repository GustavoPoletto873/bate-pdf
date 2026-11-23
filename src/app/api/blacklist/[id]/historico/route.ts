import { ErroDeUso, responder } from '@/lib/api';
import { historico } from '@/lib/blacklist';

export const dynamic = 'force-dynamic';

/** Todas as bases em que a entidade aparece. */
export async function GET(_request: Request, ctx: RouteContext<'/api/blacklist/[id]/historico'>) {
  return responder(async () => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) throw new ErroDeUso('Entrada não encontrada.', 404);
    return Response.json(await historico(id));
  });
}
