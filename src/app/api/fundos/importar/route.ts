import { ErroDeUso, responder } from '@/lib/api';
import { importarFundos } from '@/lib/fundos';

export const dynamic = 'force-dynamic';

/** Importação em lote (multipart "arquivo"). ?simular=1 devolve a prévia sem gravar. */
export async function POST(request: Request) {
  return responder(async () => {
    const form = await request.formData();
    const arquivo = form.get('arquivo');
    if (!(arquivo instanceof File)) throw new ErroDeUso('Escolha a planilha de fundos (.xlsx ou .csv).');
    const simular = new URL(request.url).searchParams.get('simular') === '1';
    return Response.json(await importarFundos(new Uint8Array(await arquivo.arrayBuffer()), arquivo.name, simular));
  });
}
