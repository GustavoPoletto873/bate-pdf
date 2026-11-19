import { responder } from '@/lib/api';
import { analisarTabela, lerTabela } from '@/lib/upload-base/planilha';
import { lerFormulario } from '../formulario';

export const dynamic = 'force-dynamic';

/** "Analisar Arquivo": colunas do arquivo e o mapeamento sugerido (multipart "arquivo"). */
export async function POST(request: Request) {
  return responder(async () => {
    const { arquivo } = await lerFormulario(request);
    return Response.json(analisarTabela(await lerTabela(arquivo.conteudo, arquivo.nome)));
  });
}
