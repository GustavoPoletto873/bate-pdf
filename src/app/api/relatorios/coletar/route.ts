import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { coletarTodas } from '@/lib/relatorios/relatorios';

export const dynamic = 'force-dynamic';

/** Baixa o informe mensal da CVM da data-base e guarda a carteira de todos os fundos. */
export async function POST(request: Request) {
  return responder(async () => {
    const { data_base, forcar } = await lerJson<{ data_base?: string; forcar?: boolean }>(request);
    if (!data_base) throw new ErroDeUso('Escolha a data-base.');
    return Response.json(await coletarTodas(data_base, Boolean(forcar)));
  });
}
