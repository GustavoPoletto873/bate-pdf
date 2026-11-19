import { lerJson, responder } from '@/lib/api';
import { emitir, type TipoRelatorio } from '@/lib/relatorios/relatorios';

export const dynamic = 'force-dynamic';

/** Gera os .docx pedidos a partir do rascunho revisado. */
export async function POST(request: Request, ctx: RouteContext<'/api/relatorios/rascunho/[id]/emitir'>) {
  return responder(async () => {
    const b = await lerJson<{ tipos?: TipoRelatorio[]; confirmar_sem_base?: boolean; sem_pendencias?: boolean }>(request);
    const emitidos = await emitir((await ctx.params).id, b.tipos ?? [], { confirmarSemBase: b.confirmar_sem_base, semPendencias: b.sem_pendencias });
    return Response.json({ emitidos });
  });
}
