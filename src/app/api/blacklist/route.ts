import { lerJson, responder } from '@/lib/api';
import { criar, listar } from '@/lib/blacklist';

export const dynamic = 'force-dynamic';

/** Entidades monitoradas, cada uma com as ocorrências na base mais recente de cada fundo. */
export async function GET() {
  return responder(async () => Response.json({ items: await listar() }));
}

/** Cadastra { nome, documento } e já varre todas as bases. */
export async function POST(request: Request) {
  return responder(async () => {
    const { nome, documento } = await lerJson<{ nome?: string; documento?: string }>(request);
    return Response.json(await criar(nome, documento), { status: 201 });
  });
}
