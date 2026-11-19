import { lerJson, responder } from '@/lib/api';
import { atualizarEmLote } from '@/lib/fundos';

export const dynamic = 'force-dynamic';

/** Mesma administradora e/ou gestor para vários fundos: { ids, administradora_id?, gestor? }. */
export async function PUT(request: Request) {
  return responder(async () => {
    const { ids, ...dados } = await lerJson<{ ids: number[]; administradora_id?: number | null; gestor?: string | null }>(request);
    return Response.json({ atualizados: atualizarEmLote(Array.isArray(ids) ? ids : [], dados) });
  });
}
