import { responder } from '@/lib/api';
import { inspecionar } from '@/lib/amostra/servico';
import { arquivosDo, textoDo } from '@/lib/amostra/formulario';
import { lerFormulario } from '@/lib/envio';

export const dynamic = 'force-dynamic';

/**
 * Lê os arquivos sem registrar nada (multipart `arquivos[]`): a data-base do estoque (com
 * data_base=1, pela mesma leitura do sorteio) e o nome/CNPJ do fundo escrito na primeira linha.
 */
export async function POST(request: Request) {
  return responder(async () => {
    const form = await lerFormulario(request);
    const arquivos = await arquivosDo(form, 'arquivos');
    return Response.json({ arquivos: await inspecionar(arquivos, textoDo(form, 'data_base') === '1') });
  });
}
