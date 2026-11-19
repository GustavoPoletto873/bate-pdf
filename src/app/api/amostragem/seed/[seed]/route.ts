import { responder } from '@/lib/api';
import { buscarPorSeed } from '@/lib/amostra/servico';

export const dynamic = 'force-dynamic';

/** Amostra registrada com esta seed (para a conferência mostrar de qual amostra ela é). */
export async function GET(_request: Request, ctx: RouteContext<'/api/amostragem/seed/[seed]'>) {
  return responder(async () => {
    const { seed } = await ctx.params;
    return Response.json(buscarPorSeed(decodeURIComponent(seed)));
  });
}
