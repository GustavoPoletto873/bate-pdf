import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { desvincular, vincular, type PedidoVinculo } from '@/lib/repo';
import { usuarioAtual } from '@/lib/usuario';

/** Vincula pendências a PDFs: { itens: [{pendencia_id, pdf_id, pagina?, origem?}] }. */
export async function POST(request: Request, ctx: RouteContext<'/api/bases/[id]/vinculos'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const { itens, usuario } = await lerJson<{ itens: PedidoVinculo[]; usuario?: string }>(request);
    if (!Array.isArray(itens) || !itens.length) throw new ErroDeUso('Nenhuma pendência para vincular.');
    // Na nuvem vale quem está logado; na versão local (sem login), o que a tela mandar.
    const r = await vincular(id, itens, (await usuarioAtual()) ?? usuario);
    return Response.json(r, { status: r.recusados.length ? 409 : 200 });
  });
}

/** Desfaz vínculos: { pendencia_ids: number[] }. */
export async function DELETE(request: Request, ctx: RouteContext<'/api/bases/[id]/vinculos'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const { pendencia_ids } = await lerJson<{ pendencia_ids: number[] }>(request);
    if (!Array.isArray(pendencia_ids) || !pendencia_ids.length) throw new ErroDeUso('Nenhuma pendência informada.');
    return Response.json(await desvincular(id, pendencia_ids));
  });
}
