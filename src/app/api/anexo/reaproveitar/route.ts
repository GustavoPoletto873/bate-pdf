import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { reaproveitarLeituras } from '@/lib/anexo/lotes';

export const dynamic = 'force-dynamic';

/** Reaproveitar Leitura de outra Base: { origem, destino } (bases do mesmo fundo). */
export async function POST(request: Request) {
  return responder(async () => {
    const corpo = await lerJson<{ origem?: string; destino?: string }>(request);
    if (!corpo.origem || !corpo.destino) throw new ErroDeUso('Selecione as bases de origem e de destino.');
    return Response.json({ copiadas: reaproveitarLeituras(corpo.origem, corpo.destino) });
  });
}
