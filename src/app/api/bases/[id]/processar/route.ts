import { ErroDeUso, responder } from '@/lib/api';
import { obterBase } from '@/lib/repo';
import { podeProcessar, processarBase } from '@/lib/bates/processar';

export const dynamic = 'force-dynamic';

export async function GET(_req: Request, ctx: RouteContext<'/api/bases/[id]/processar'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    if (!obterBase(id)) throw new ErroDeUso('Base não encontrada.', 404);
    return Response.json(podeProcessar(id));
  });
}

/** "Processar Base": roda a cascata e grava os pré-bates. */
export async function POST(_req: Request, ctx: RouteContext<'/api/bases/[id]/processar'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    if (!obterBase(id)) throw new ErroDeUso('Base não encontrada.', 404);
    if (!podeProcessar(id).pode_processar) {
      throw new ErroDeUso('Não há documentos novos desde o último processamento: todos os lidos já estão pareados. Envie novos documentos antes de processar de novo.', 409);
    }
    return Response.json(processarBase(id));
  });
}
