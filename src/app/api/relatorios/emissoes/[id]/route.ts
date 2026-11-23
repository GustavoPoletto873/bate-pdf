import { responder } from '@/lib/api';
import { arquivoDaEmissao } from '@/lib/relatorios/relatorios';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: RouteContext<'/api/relatorios/emissoes/[id]'>) {
  return responder(async () => {
    const { nome, conteudo } = await arquivoDaEmissao((await ctx.params).id);
    return new Response(new Uint8Array(conteudo), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`,
      },
    });
  });
}
