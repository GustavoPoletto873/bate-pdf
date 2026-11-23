import { ErroDeUso, responder } from '@/lib/api';
import { expandirZip, ZipRecusado } from '@/lib/anexo/zip';
import { lerFormulario } from '@/lib/envio';

export const dynamic = 'force-dynamic';

/** Conteúdo de um ZIP para a prévia do agrupamento (mesmos limites do processamento). */
export async function POST(request: Request) {
  return responder(async () => {
    const form = await lerFormulario(request);
    const arquivo = form.get('arquivo');
    if (!(arquivo instanceof File)) throw new ErroDeUso('Envie o arquivo ZIP.');
    try {
      const entradas = await expandirZip(new Uint8Array(await arquivo.arrayBuffer()), arquivo.name);
      return Response.json({ caminhos: entradas.map((e) => e.caminho) });
    } catch (e) {
      if (e instanceof ZipRecusado) throw new ErroDeUso(`${arquivo.name}: ${e.message}`, 422);
      throw e;
    }
  });
}
