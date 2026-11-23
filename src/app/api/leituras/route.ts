import { responder } from '@/lib/api';
import { buscarLeituras, filtrosDaUrl } from '@/lib/anexo/visualizar';

export const dynamic = 'force-dynamic';

/** Visualizar: leituras filtradas e paginadas. ?<filtros>&pagina&ordenar&direcao */
export async function GET(request: Request) {
  return responder(async () => {
    const p = new URL(request.url).searchParams;
    return Response.json(await buscarLeituras(filtrosDaUrl(p), {
      pagina: Number(p.get('pagina')) || 1,
      porPagina: Number(p.get('por_pagina')) || 15,
      ordenarPor: p.get('ordenar') ?? undefined,
      direcao: p.get('direcao') ?? undefined,
    }));
  });
}
