import { responder } from '@/lib/api';
import { obter } from '@/lib/amostra/servico';
import { idDaRota } from '@/lib/amostra/formulario';

export const dynamic = 'force-dynamic';

/**
 * Uma amostra: { id, fundo_id, fundo, cnpj_fundo, seed, versao, regra ('padrao'|'planner'), data_de,
 * data_ate, status ('GERADA'|'DESCARTADA'), contagem, total_titulos, insumos… }. O Upload Base usa
 * esta rota (e /download/amostra) no "Usar como base" (/base?amostra=<id>).
 */
export async function GET(_request: Request, ctx: RouteContext<'/api/amostragem/[id]'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    return Response.json(obter(idDaRota(id)));
  });
}
