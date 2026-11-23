import { lerJson, responder } from '@/lib/api';
import { descartar } from '@/lib/amostra/servico';
import { idDaRota } from '@/lib/amostra/formulario';

export const dynamic = 'force-dynamic';

/** Descarta com motivo (a amostra continua no histórico). Corpo: { motivo }. */
export async function POST(request: Request, ctx: RouteContext<'/api/amostragem/[id]/descartar'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const { motivo } = await lerJson<{ motivo?: string }>(request);
    return Response.json(await descartar(idDaRota(id), motivo ?? ''));
  });
}
