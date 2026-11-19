import { responder } from '@/lib/api';
import { amostraDoTipo } from '@/lib/treino';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: RouteContext<'/api/treino/tipos/[id]/amostra'>) {
  return responder(async () => new Response(new Uint8Array(amostraDoTipo(Number((await ctx.params).id))), { headers: { 'Content-Type': 'application/pdf' } }));
}
