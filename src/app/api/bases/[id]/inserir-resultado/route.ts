import { ErroDeUso, responder } from '@/lib/api';
import { obterBase } from '@/lib/repo';
import { inserirResultado, MAX_BYTES_PLANILHA } from '@/lib/bates/inserirResultado';
import { lerFormulario } from '@/lib/envio';

export const dynamic = 'force-dynamic';

/** Inserir Resultado: multipart com `arquivo` (.xlsx) e `simular` ('1' = só a prévia; '0' grava). */
export async function POST(request: Request, ctx: RouteContext<'/api/bases/[id]/inserir-resultado'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    if (!await obterBase(id)) throw new ErroDeUso('Base não encontrada.', 404);
    let form: FormData;
    try {
      form = await lerFormulario(request);
    } catch {
      throw new ErroDeUso('Envie o arquivo .xlsx exportado em Resultados.');
    }
    const arquivo = form.get('arquivo');
    if (!(arquivo instanceof File)) throw new ErroDeUso('Envie o arquivo .xlsx exportado em Resultados.');
    if (!/\.xlsx$/i.test(arquivo.name)) throw new ErroDeUso('Envie o .xlsx exportado em Resultados.');
    if (arquivo.size > MAX_BYTES_PLANILHA) throw new ErroDeUso('A planilha passa de 20 MB. Confira se é o arquivo exportado em Resultados.', 413);
    const simular = form.get('simular') !== '0';
    return Response.json(await inserirResultado(id, new Uint8Array(await arquivo.arrayBuffer()), arquivo.name, simular));
  });
}
