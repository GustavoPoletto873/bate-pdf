import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { criarLote } from '@/lib/blacklist';

export const dynamic = 'force-dynamic';

/** Cadastro em lote: { itens: [{ nome, documento }] } (até 500); erro por linha sem derrubar o resto. */
export async function POST(request: Request) {
  return responder(async () => {
    const { itens } = await lerJson<{ itens?: { nome?: string; documento?: string }[] }>(request);
    if (!Array.isArray(itens)) throw new ErroDeUso('Nenhum item informado.');
    return Response.json(await criarLote(itens), { status: 201 });
  });
}
