import { ErroDeUso, responder } from '@/lib/api';
import { remover } from '@/lib/blacklist';

export const dynamic = 'force-dynamic';

/** Remove da BlackList (exclusão lógica; as ocorrências dela são apagadas). */
export async function DELETE(_request: Request, ctx: RouteContext<'/api/blacklist/[id]'>) {
  return responder(async () => {
    const id = Number((await ctx.params).id);
    if (!Number.isInteger(id)) throw new ErroDeUso('Entrada não encontrada.', 404);
    remover(id);
    return Response.json({ ok: true });
  });
}
