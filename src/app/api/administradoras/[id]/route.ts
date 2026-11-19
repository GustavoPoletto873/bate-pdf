import { lerJson, responder } from '@/lib/api';
import { atualizarAdministradora } from '@/lib/fundos';

export const dynamic = 'force-dynamic';

/** { razao_social, endereco, endereco_complemento }: os dados que saem nos relatórios CVM/NIX. */
export async function PATCH(request: Request, ctx: RouteContext<'/api/administradoras/[id]'>) {
  return responder(async () => {
    const dados = await lerJson<{ razao_social?: string; endereco?: string; endereco_complemento?: string }>(request);
    return Response.json({ administradora: atualizarAdministradora(Number((await ctx.params).id), dados) });
  });
}
