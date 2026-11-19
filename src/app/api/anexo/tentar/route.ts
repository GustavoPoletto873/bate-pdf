import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { documentosComErro, tentarDeNovo } from '@/lib/anexo/lotes';

export const dynamic = 'force-dynamic';

/** "Tentar de novo": { documento_ids } ou { base_id } (todos os com erro da base). */
export async function POST(request: Request) {
  return responder(async () => {
    const corpo = await lerJson<{ documento_ids?: number[]; base_id?: string }>(request);
    const ids = corpo.base_id ? documentosComErro(corpo.base_id) : (corpo.documento_ids ?? []).filter((n) => Number.isInteger(n));
    if (!ids.length) throw new ErroDeUso('Nenhum documento com erro para tentar de novo.');
    return Response.json({ reenfileirados: tentarDeNovo(ids) });
  });
}
