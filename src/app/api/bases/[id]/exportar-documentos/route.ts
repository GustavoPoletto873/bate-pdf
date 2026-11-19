import { responder } from '@/lib/api';
import { exportarDocumentos } from '@/lib/bates/exportarDocumentos';

export const dynamic = 'force-dynamic';

/** ZIP com os documentos da base para o dossiê da auditoria (?escopo=vinculados|todos). */
export async function GET(request: Request, ctx: RouteContext<'/api/bases/[id]/exportar-documentos'>) {
  return responder(async () => {
    const escopo = new URL(request.url).searchParams.get('escopo') === 'todos' ? 'todos' : 'vinculados';
    const { nome, zip } = await exportarDocumentos((await ctx.params).id, escopo);
    return new Response(new Uint8Array(zip), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${nome}"` } });
  });
}
