import { lerJson, responder } from '@/lib/api';
import { obterRascunho, salvarEscolhas } from '@/lib/relatorios/relatorios';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: RouteContext<'/api/relatorios/rascunho/[id]'>) {
  return responder(async () => Response.json(obterRascunho((await ctx.params).id)));
}

/** Grava as escolhas de redação e os textos próprios da revisão. */
export async function PATCH(request: Request, ctx: RouteContext<'/api/relatorios/rascunho/[id]'>) {
  return responder(async () => {
    const { escolhas, overrides } = await lerJson<{ escolhas?: Record<string, string>; overrides?: Record<string, string> }>(request);
    return Response.json(salvarEscolhas((await ctx.params).id, escolhas ?? {}, overrides ?? {}));
  });
}
