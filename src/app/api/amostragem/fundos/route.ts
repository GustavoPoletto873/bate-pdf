import { responder } from '@/lib/api';
import { listarFundos } from '@/lib/amostra/servico';

export const dynamic = 'force-dynamic';

/** Fundos cadastrados (com a administradora) para a tela de Amostra. */
export async function GET() {
  return responder(async () => Response.json({ fundos: await listarFundos() }));
}
