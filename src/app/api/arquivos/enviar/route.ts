import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { armazenamentoNaNuvem } from '@/lib/arquivos';
import { usuarioAtual } from '@/lib/usuario';

/**
 * Na nuvem, o navegador manda os arquivos direto para o Vercel Blob (a Vercel limita o corpo de
 * uma requisição a ~4,5 MB). Esta rota só emite o token de envio, para a pasta temporária
 * `uploads/`; quem recebe o arquivo de fato é a rota de destino (lerFormulario, em lib/envio.ts).
 */
export async function POST(request: Request) {
  if (!armazenamentoNaNuvem()) return Response.json({ erro: 'Envio direto só existe na versão na nuvem.' }, { status: 404 });
  const corpo = (await request.json()) as HandleUploadBody;
  try {
    const r = await handleUpload({
      body: corpo,
      request,
      onBeforeGenerateToken: async (pathname) => {
        if (!(await usuarioAtual()) || !/^uploads\/[0-9a-f-]{36}\/[^/]+$/.test(pathname)) throw new Error('Envio não permitido.');
        return { addRandomSuffix: false, allowOverwrite: false, maximumSizeInBytes: 500 * 1024 * 1024 };
      },
    });
    return Response.json(r);
  } catch (e) {
    return Response.json({ erro: (e as Error).message }, { status: 400 });
  }
}
