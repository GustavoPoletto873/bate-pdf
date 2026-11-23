import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { iniciarConsulta, progressoConsulta } from '@/lib/notasFiscais';

export const dynamic = 'force-dynamic';

/** Andamento da consulta no SERPRO de uma base (?base=). */
export async function GET(request: Request) {
  return responder(() => {
    const base = new URL(request.url).searchParams.get('base');
    if (!base) throw new ErroDeUso('Informe a base.');
    return Response.json({ progresso: progressoConsulta(base) });
  });
}

/** Começa a consultar no SERPRO todas as chaves de NF-e da base. */
export async function POST(request: Request) {
  return responder(async () => {
    const { base_id } = await lerJson<{ base_id?: string }>(request);
    if (!base_id) throw new ErroDeUso('Escolha a base.');
    return Response.json({ progresso: await iniciarConsulta(base_id) }, { status: 202 });
  });
}
