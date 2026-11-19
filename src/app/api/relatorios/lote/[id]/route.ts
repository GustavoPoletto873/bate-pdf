import { responder } from '@/lib/api';
import { zipDoLote } from '@/lib/relatorios/relatorios';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: RouteContext<'/api/relatorios/lote/[id]'>) {
  return responder(async () => {
    const zip = await zipDoLote((await ctx.params).id);
    return new Response(new Uint8Array(zip), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="relatorios_${new Date().toISOString().slice(0, 10)}.zip"` },
    });
  });
}
