import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { prepararRascunho } from '@/lib/relatorios/relatorios';

export const dynamic = 'force-dynamic';

/** Cria (ou refaz) o rascunho de um fundo na data-base: coleta a carteira e congela o snapshot. */
export async function POST(request: Request) {
  return responder(async () => {
    const b = await lerJson<{ fundo_id?: number; data_base?: string; antecipada?: boolean; forcar?: boolean }>(request);
    if (!b.fundo_id || !b.data_base) throw new ErroDeUso('Escolha o fundo e a data-base.');
    return Response.json(await prepararRascunho(Number(b.fundo_id), b.data_base, { antecipada: b.antecipada, forcar: b.forcar }));
  });
}
