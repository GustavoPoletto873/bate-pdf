import { lerJson, responder } from '@/lib/api';
import { criarAdministradora, listarAdministradoras } from '@/lib/fundos';

export const dynamic = 'force-dynamic';

export async function GET() {
  return responder(async () => Response.json({ itens: await listarAdministradoras() }));
}

/** Nova administradora: { nome }. Nome repetido (sem diferenciar acento e caixa) é recusado. */
export async function POST(request: Request) {
  return responder(async () => {
    const { nome } = await lerJson<{ nome?: string }>(request);
    return Response.json({ administradora: await criarAdministradora(nome) }, { status: 201 });
  });
}
