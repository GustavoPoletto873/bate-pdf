import { responder } from '@/lib/api';
import { xmlDaNota } from '@/lib/notasFiscais';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: RouteContext<'/api/notas-fiscais/[id]/xml'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const { chave_nfe, xml } = xmlDaNota(Number(id));
    return new Response(xml, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Content-Disposition': `attachment; filename="NFe_${chave_nfe}.xml"` },
    });
  });
}
