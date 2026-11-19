import { ErroDeUso, responder } from '@/lib/api';
import { obterBase } from '@/lib/repo';
import { estatisticas, filtrarResultados, linhasDeResultado } from '@/lib/bates/resultados';

export const dynamic = 'force-dynamic';

/** ?aba=todos|termo|lastro &status=todos|V|P &q=texto &pagina=1 &tamanho=50 */
export async function GET(request: Request, ctx: RouteContext<'/api/bases/[id]/resultados'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const base = obterBase(id);
    if (!base) throw new ErroDeUso('Base não encontrada. Volte para Bates e escolha a base de novo.', 404);
    const q = new URL(request.url).searchParams;
    const aba = q.get('aba') ?? 'todos';
    const status = q.get('status') ?? 'todos';
    if (!['todos', 'termo', 'lastro'].includes(aba) || !['todos', 'V', 'P'].includes(status)) throw new ErroDeUso('Filtro inválido.');
    const linhas = linhasDeResultado(id);
    const pagina = filtrarResultados(linhas, {
      aba: aba as 'todos' | 'termo' | 'lastro', status: status as 'todos' | 'V' | 'P', texto: q.get('q') ?? '',
      pagina: Number(q.get('pagina') ?? 1) || 1, tamanho: Number(q.get('tamanho') ?? 50) || 50,
    });
    return Response.json({ base, estatisticas: estatisticas(linhas), ...pagina });
  });
}
