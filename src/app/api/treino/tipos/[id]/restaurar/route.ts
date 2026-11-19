import { responder } from '@/lib/api';
import { restaurarTipo } from '@/lib/treino';

export const dynamic = 'force-dynamic';

export async function POST(_request: Request, ctx: RouteContext<'/api/treino/tipos/[id]/restaurar'>) {
  return responder(async () => Response.json({ tipo: restaurarTipo(Number((await ctx.params).id)) }));
}
