import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { criarLote } from '@/lib/anexo/lotes';

export const dynamic = 'force-dynamic';

/** Cria o lote: { base_id, agrupar }. Os arquivos chegam depois, em levas. */
export async function POST(request: Request) {
  return responder(async () => {
    const corpo = await lerJson<{ base_id?: string; agrupar?: boolean }>(request);
    if (!corpo.base_id) throw new ErroDeUso('Selecione a base.');
    return Response.json({ id: await criarLote(corpo.base_id, corpo.agrupar === true) });
  });
}
