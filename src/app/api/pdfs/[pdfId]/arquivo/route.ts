import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ErroDeUso, responder } from '@/lib/api';
import { pastaDePdfs } from '@/lib/db';
import { obterPdf } from '@/lib/repo';

/** O PDF cru, para o visualizador (o nome em disco é o sha256: o conteúdo nunca muda). */
export async function GET(_req: Request, ctx: RouteContext<'/api/pdfs/[pdfId]/arquivo'>) {
  return responder(async () => {
    const { pdfId } = await ctx.params;
    const pdf = obterPdf(Number(pdfId));
    if (!pdf) throw new ErroDeUso('PDF não encontrado.', 404);
    const bytes = await readFile(join(pastaDePdfs(pdf.base_id), `${pdf.sha256}.pdf`));
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(pdf.nome_arquivo)}`,
        'Cache-Control': 'private, max-age=31536000, immutable',
      },
    });
  });
}
