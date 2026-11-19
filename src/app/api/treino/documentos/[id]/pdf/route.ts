import { responder } from '@/lib/api';
import { pdfDoDocumento } from '@/lib/treino';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: RouteContext<'/api/treino/documentos/[id]/pdf'>) {
  return responder(async () => {
    const { nome, bytes } = pdfDoDocumento(Number((await ctx.params).id));
    return new Response(new Uint8Array(bytes), {
      headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(nome)}` },
    });
  });
}
