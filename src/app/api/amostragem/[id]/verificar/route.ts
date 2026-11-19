import { responder } from '@/lib/api';
import { verificar } from '@/lib/amostra/servico';
import { idDaRota } from '@/lib/amostra/formulario';

export const dynamic = 'force-dynamic';

/** Refaz com os estoques guardados e diz se a amostra sai idêntica à registrada. */
export async function POST(_request: Request, ctx: RouteContext<'/api/amostragem/[id]/verificar'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    return Response.json(await verificar(idDaRota(id)));
  });
}
