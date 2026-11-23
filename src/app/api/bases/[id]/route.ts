import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { atualizarBase, excluirBase, obterBase } from '@/lib/repo';
import { indexando } from '@/lib/indexacao';

export async function GET(_req: Request, ctx: RouteContext<'/api/bases/[id]'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const base = await obterBase(id);
    if (!base) throw new ErroDeUso('Base não encontrada.', 404);
    return Response.json({ base, indexando: indexando(id) });
  });
}

export async function PATCH(request: Request, ctx: RouteContext<'/api/bases/[id]'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    if (!await obterBase(id)) throw new ErroDeUso('Base não encontrada.', 404);
    const dados = await lerJson<Record<string, string | null>>(request);
    if (dados.cnpj_fundo) {
      const d = dados.cnpj_fundo.replace(/\D/g, '');
      if (d.length !== 14) throw new ErroDeUso('O CNPJ do fundo precisa ter 14 dígitos.');
      dados.cnpj_fundo = d;
    }
    await atualizarBase(id, dados);
    return Response.json({ base: await obterBase(id) });
  });
}

export async function DELETE(_req: Request, ctx: RouteContext<'/api/bases/[id]'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    await excluirBase(id);
    return Response.json({ ok: true });
  });
}
