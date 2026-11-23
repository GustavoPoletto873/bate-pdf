import { ErroDeUso, responder } from '@/lib/api';
import { atualizarTipo, excluirTipo, obterTipo, pdfDoDocumento } from '@/lib/treino';
import { lerFormularioTipo } from '../../comum';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, ctx: RouteContext<'/api/treino/tipos/[id]'>) {
  return responder(async () => Response.json({ tipo: obterTipo(Number((await ctx.params).id)) }));
}

/** Edição (multipart: config, versao e, se mudou, amostra ou documento_id). */
export async function PUT(request: Request, ctx: RouteContext<'/api/treino/tipos/[id]'>) {
  return responder(async () => {
    const f = await lerFormularioTipo(request);
    if (f.versao === null || !Number.isInteger(f.versao)) throw new ErroDeUso('Versão do tipo ausente. Recarregue a página.');
    const amostra = f.amostra ?? (f.documentoId ? pdfDoDocumento(f.documentoId).bytes : null);
    return Response.json({ tipo: atualizarTipo(Number((await ctx.params).id), f.config, f.versao, amostra) });
  });
}

/** Desativa (sai da classificação; dá para restaurar). */
export async function DELETE(_request: Request, ctx: RouteContext<'/api/treino/tipos/[id]'>) {
  return responder(async () => {
    excluirTipo(Number((await ctx.params).id));
    return new Response(null, { status: 204 });
  });
}
