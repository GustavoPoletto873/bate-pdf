import { ErroDeUso, responder } from '@/lib/api';
import { obterBase } from '@/lib/repo';
import { painelDaBase } from '@/lib/bates/preMatches';

export const dynamic = 'force-dynamic';

/** Cabeçalho da Gestão de Bates: a base, os cartões e se dá para processar. */
export async function GET(_req: Request, ctx: RouteContext<'/api/bases/[id]/bates'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const base = obterBase(id);
    if (!base) throw new ErroDeUso('Base não encontrada. Volte para Bates e escolha a base de novo.', 404);
    return Response.json({ base, painel: painelDaBase(id) });
  });
}
