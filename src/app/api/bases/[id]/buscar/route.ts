import { responder } from '@/lib/api';
import { buscarNosPdfs } from '@/lib/repo';

export async function GET(request: Request, ctx: RouteContext<'/api/bases/[id]/buscar'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const q = new URL(request.url).searchParams.get('q') ?? '';
    return Response.json(buscarNosPdfs(id, q));
  });
}
