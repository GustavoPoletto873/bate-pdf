import { ErroDeUso, responder } from '@/lib/api';
import { chaveDoPdf, lerArquivo } from '@/lib/arquivos';
import { obterPdf } from '@/lib/repo';

/** O PDF cru, para o visualizador (o nome em disco é o sha256: o conteúdo nunca muda). */
export async function GET(_req: Request, ctx: RouteContext<'/api/pdfs/[pdfId]/arquivo'>) {
  return responder(async () => {
    const { pdfId } = await ctx.params;
    const pdf = await obterPdf(Number(pdfId));
    if (!pdf) throw new ErroDeUso('PDF não encontrado.', 404);
    const bytes = await lerArquivo(chaveDoPdf(pdf.base_id, pdf.sha256));
    if (!bytes) throw new ErroDeUso('O arquivo deste PDF não está mais no armazenamento.', 404);
    return new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(pdf.nome_arquivo)}`,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  });
}
