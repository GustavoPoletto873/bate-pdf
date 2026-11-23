import { responder } from '@/lib/api';
import { listarPendencias } from '@/lib/repo';

export async function GET(_req: Request, ctx: RouteContext<'/api/bases/[id]/pendencias'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    return Response.json({ pendencias: await listarPendencias(id) });
  });
}
