import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { obterBase } from '@/lib/repo';
import { definirFinalizada } from '@/lib/auditoria';

export const dynamic = 'force-dynamic';

/** Resultados › Status da Auditoria: { finalizada: boolean }. */
export async function POST(request: Request, ctx: RouteContext<'/api/bases/[id]/finalizar'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    if (!obterBase(id)) throw new ErroDeUso('Base não encontrada.', 404);
    const { finalizada } = await lerJson<{ finalizada: boolean }>(request);
    if (typeof finalizada !== 'boolean') throw new ErroDeUso('Informe se a auditoria está finalizada.');
    definirFinalizada(id, finalizada);
    return Response.json({ base: obterBase(id) });
  });
}
