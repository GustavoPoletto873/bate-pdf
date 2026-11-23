import { ErroDeUso, responder } from '@/lib/api';
import { buscarBases } from '@/lib/anexo/lotes';

export const dynamic = 'force-dynamic';

/** Buscar Operações: ?fundo_id&data&modo=TRIMESTRE|DATA_REFERENCIA; ?id=<base> traz uma; sem nada, as recentes. */
export async function GET(request: Request) {
  return responder(async () => {
    const p = new URL(request.url).searchParams;
    const id = p.get('id') ?? undefined;
    const fundo = p.get('fundo_id');
    const fundoId = fundo ? Number(fundo) : undefined;
    if (fundo && !Number.isInteger(fundoId)) throw new ErroDeUso('Fundo inválido.');
    const modo = p.get('modo') === 'TRIMESTRE' ? 'TRIMESTRE' : 'DATA_REFERENCIA';
    return Response.json({ bases: await buscarBases({ id, fundoId, data: p.get('data') || undefined, modo }) });
  });
}
