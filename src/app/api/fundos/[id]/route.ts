import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { atualizarFundo, excluirFundo, obterFundo, usoDoFundo, type DadosFundo } from '@/lib/fundos';

export const dynamic = 'force-dynamic';

async function idDe(ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  if (!Number.isInteger(id)) throw new ErroDeUso('Fundo não encontrado.', 404);
  return id;
}

/** O fundo e o que depende dele (bases e amostras), para o aviso antes de excluir. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const id = await idDe(ctx);
    const fundo = await obterFundo(id);
    if (!fundo) throw new ErroDeUso('Fundo não encontrado. Atualize a lista.', 404);
    return Response.json({ fundo, uso: await usoDoFundo(id) });
  });
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const id = await idDe(ctx);
    const dados = await lerJson<Partial<Omit<DadosFundo, 'cnpj'>>>(request);
    return Response.json({ fundo: await atualizarFundo(id, dados) });
  });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    await excluirFundo(await idDe(ctx));
    return Response.json({ ok: true });
  });
}
