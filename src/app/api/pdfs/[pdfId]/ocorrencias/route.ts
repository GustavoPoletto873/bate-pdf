import { join } from 'node:path';
import { ErroDeUso, responder } from '@/lib/api';
import { db, pastaDePdfs } from '@/lib/db';
import { MIN_CHARS_BUSCA, obterPdf } from '@/lib/repo';
import { normalizarTexto } from '@/lib/texto';
import { caixasDasFaixas, type Caixa } from '@/lib/pdf/pdfium';

const MAX_PAGINAS = 60;

/**
 * Ocorrências do termo no PDF, com as caixas normalizadas de cada uma, para o
 * visualizador destacar (o /buscar do pdf_viewer do Bate Lastro). ?q=
 */
export async function GET(request: Request, ctx: RouteContext<'/api/pdfs/[pdfId]/ocorrencias'>) {
  return responder(async () => {
    const { pdfId } = await ctx.params;
    const pdf = obterPdf(Number(pdfId));
    if (!pdf) throw new ErroDeUso('PDF não encontrado.', 404);
    const alvo = normalizarTexto(new URL(request.url).searchParams.get('q') ?? '').trim();
    if (alvo.length < MIN_CHARS_BUSCA) return Response.json({ paginas: [] });

    const paginas = db().prepare(`SELECT p.numero, p.texto_normalizado FROM paginas_fts f JOIN paginas p ON p.id = f.rowid
      WHERE f.texto_normalizado LIKE ? AND p.pdf_id = ? ORDER BY p.numero LIMIT ?`)
      .all(`%${alvo.replace(/%/g, '')}%`, pdf.id, MAX_PAGINAS) as { numero: number; texto_normalizado: string }[];
    const caminho = join(pastaDePdfs(pdf.base_id), `${pdf.sha256}.pdf`);
    const saida: { pagina: number; caixas: Caixa[] }[] = [];
    for (const pg of paginas) {
      const faixas: [number, number][] = [];
      for (let i = pg.texto_normalizado.indexOf(alvo); i >= 0; i = pg.texto_normalizado.indexOf(alvo, i + alvo.length)) {
        faixas.push([i, i + alvo.length]);
      }
      if (!faixas.length) continue;
      const r = await caixasDasFaixas(caminho, pg.numero, faixas);
      saida.push({ pagina: pg.numero, caixas: r.caixas.flat() });
    }
    return Response.json({ paginas: saida });
  });
}
