import { responder } from '@/lib/api';
import { filtrarFundos } from '@/lib/fundos';

export const dynamic = 'force-dynamic';

/** Fundos cadastrados (Gestão › Fundos) para a etapa Parâmetros do Anexo. */
export async function GET() {
  return responder(async () => Response.json({ fundos: (await filtrarFundos()).map((f) => ({ id: f.id, nome: f.nome, cnpj: f.cnpj, bases: f.bases })) }));
}
