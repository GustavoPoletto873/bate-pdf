import { join } from 'node:path';
import { ErroDeUso, responder } from '@/lib/api';
import { pastaDePdfs } from '@/lib/db';
import { obterPdf } from '@/lib/repo';
import { caixasDasFaixas } from '@/lib/pdf/pdfium';

/**
 * Onde estão, na página, os trechos que o motor marcou (o /recorte do Bate Lastro,
 * mas devolvendo as caixas: quem desenha é o navegador).
 * ?pagina=N&trechos=V:12-20,D:30-40&regiao=100-180
 */
export async function GET(request: Request, ctx: RouteContext<'/api/pdfs/[pdfId]/caixas'>) {
  return responder(async () => {
    const { pdfId } = await ctx.params;
    const pdf = obterPdf(Number(pdfId));
    if (!pdf) throw new ErroDeUso('PDF não encontrado.', 404);
    const params = new URL(request.url).searchParams;
    const pagina = Number(params.get('pagina'));
    if (!Number.isInteger(pagina) || pagina < 1) throw new ErroDeUso('Página inválida.');

    const pedidos: { tipo: string; faixa: [number, number] }[] = [];
    for (const parte of (params.get('trechos') ?? '').split(',').filter(Boolean)) {
      const m = /^([A-Za-z]+):(\d+)-(\d+)$/.exec(parte);
      if (m) pedidos.push({ tipo: m[1], faixa: [Number(m[2]), Number(m[3])] });
    }
    const regiao = /^(\d+)-(\d+)$/.exec(params.get('regiao') ?? '');
    if (regiao) pedidos.push({ tipo: 'regiao', faixa: [Number(regiao[1]), Number(regiao[2])] });
    if (pedidos.length > 200) throw new ErroDeUso('Trechos demais num pedido só.');

    const r = await caixasDasFaixas(join(pastaDePdfs(pdf.base_id), `${pdf.sha256}.pdf`), pagina, pedidos.map((p) => p.faixa));
    return Response.json({
      largura: r.largura,
      altura: r.altura,
      caixas: pedidos.flatMap((p, i) => r.caixas[i].map((c) => ({ tipo: p.tipo, ...c }))),
    }, { headers: { 'Cache-Control': 'private, max-age=3600' } });
  });
}
