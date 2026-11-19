import { lerJson, responder } from '@/lib/api';
import { emitirEmLote, type TipoRelatorio } from '@/lib/relatorios/relatorios';

export const dynamic = 'force-dynamic';

/** Prepara e emite vários fundos de uma vez (o erro de um não para os outros). */
export async function POST(request: Request) {
  return responder(async () => {
    const b = await lerJson<{ fundo_ids?: number[]; data_base?: string; tipos?: TipoRelatorio[]; antecipada?: boolean; confirmar_sem_base?: boolean; sem_pendencias?: boolean }>(request);
    return Response.json(await emitirEmLote((b.fundo_ids ?? []).map(Number), b.data_base ?? '', b.tipos ?? [], {
      antecipada: b.antecipada, confirmarSemBase: b.confirmar_sem_base, semPendencias: b.sem_pendencias,
    }));
  });
}
