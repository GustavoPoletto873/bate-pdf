import { ErroDeUso, responder } from '@/lib/api';
import { obterBase } from '@/lib/repo';
import { pendenciasEOrfas } from '@/lib/bates/preMatches';

export const dynamic = 'force-dynamic';

/** Títulos ainda sem documento (por lado) e leituras sem título. */
export async function GET(_req: Request, ctx: RouteContext<'/api/bases/[id]/orfas'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    if (!await obterBase(id)) throw new ErroDeUso('Base não encontrada.', 404);
    return Response.json(await pendenciasEOrfas(id));
  });
}
