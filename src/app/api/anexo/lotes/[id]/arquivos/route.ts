import { ErroDeUso, responder } from '@/lib/api';
import { adicionarArquivos } from '@/lib/anexo/lotes';

export const dynamic = 'force-dynamic';

/** Uma leva de arquivos do lote (multipart: "arquivos" e, na mesma ordem, "caminhos"). */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  return responder(async () => {
    const { id } = await ctx.params;
    const form = await request.formData();
    const arquivos = form.getAll('arquivos').filter((a): a is File => a instanceof File);
    const caminhos = form.getAll('caminhos').map(String);
    if (!arquivos.length) throw new ErroDeUso('Nenhum arquivo enviado.');
    const entradas: { caminho: string; bytes: Uint8Array }[] = [];
    for (let i = 0; i < arquivos.length; i++) {
      entradas.push({ caminho: caminhos[i] || arquivos[i].name, bytes: new Uint8Array(await arquivos[i].arrayBuffer()) });
    }
    return Response.json(await adicionarArquivos(id, entradas));
  });
}
