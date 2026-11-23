import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { obterBase } from '@/lib/repo';
import { confirmarPreBates, listarPreBates, rejeitarPreBates } from '@/lib/bates/preMatches';
import { NIVEIS_CONFIABILIDADE } from '@/lib/bates/comparacao';

export const dynamic = 'force-dynamic';

/** ?tipo=todos|termo|lastro &confiabilidade=100,80 &pagina=1 &tamanho=50 */
export async function GET(request: Request, ctx: RouteContext<'/api/bases/[id]/pre-matches'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    if (!await obterBase(id)) throw new ErroDeUso('Base não encontrada.', 404);
    const q = new URL(request.url).searchParams;
    const tipo = q.get('tipo') ?? 'todos';
    if (!['todos', 'termo', 'lastro'].includes(tipo)) throw new ErroDeUso('O tipo precisa ser todos, termo ou lastro.');
    const niveis = (q.get('confiabilidade') ?? '').split(',').filter((v) => v.trim()).map(Number);
    if (niveis.some((n) => !(NIVEIS_CONFIABILIDADE as readonly number[]).includes(n))) {
      throw new ErroDeUso('A confiabilidade aceita só 0, 20, 40, 60, 80 e 100, separados por vírgula.');
    }
    return Response.json(await listarPreBates(id, {
      tipo: tipo as 'todos' | 'termo' | 'lastro',
      confiabilidade: niveis,
      pagina: Number(q.get('pagina') ?? 1) || 1,
      tamanho: Number(q.get('tamanho') ?? 50) || 50,
    }));
  });
}

/** Confirma ou rejeita pré-bates: { acao: 'confirmar' | 'rejeitar', ids: number[] }. */
export async function POST(request: Request, ctx: RouteContext<'/api/bases/[id]/pre-matches'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const { acao, ids } = await lerJson<{ acao: string; ids: number[] }>(request);
    if (!Array.isArray(ids) || !ids.length || ids.some((x) => !Number.isInteger(x))) throw new ErroDeUso('Selecione pelo menos um pré-bate.');
    if (acao === 'confirmar') return Response.json(await confirmarPreBates(id, ids));
    if (acao === 'rejeitar') return Response.json(await rejeitarPreBates(id, ids));
    throw new ErroDeUso('A ação precisa ser confirmar ou rejeitar.');
  });
}
