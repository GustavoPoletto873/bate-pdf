import { responder } from '@/lib/api';
import { paginasComTermo } from '@/lib/repo';

/** Páginas do PDF onde o termo aparece: ?q= */
export async function GET(request: Request, ctx: RouteContext<'/api/pdfs/[pdfId]/paginas'>) {
  return responder(async () => {
    const { pdfId } = await ctx.params;
    const q = new URL(request.url).searchParams.get('q') ?? '';
    return Response.json({ paginas: await paginasComTermo(Number(pdfId), q) });
  });
}
