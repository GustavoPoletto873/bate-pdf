import { responder } from '@/lib/api';
import { arquivo } from '@/lib/amostra/servico';
import { idDaRota } from '@/lib/amostra/formulario';

export const dynamic = 'force-dynamic';

/** amostra = a planilha (.xlsx, com a aba Reproducao); pacote = .zip com a planilha e os estoques/liquidados. */
export async function GET(_request: Request, ctx: RouteContext<'/api/amostragem/[id]/download/[tipo]'>) {
  return responder(async () => {
    const { id, tipo } = await ctx.params;
    const a = await arquivo(idDaRota(id), tipo);
    return new Response(new Uint8Array(a.conteudo), {
      headers: {
        'Content-Type': a.mime,
        'Content-Disposition': `attachment; filename="${a.nome.replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(a.nome)}`,
      },
    });
  });
}
