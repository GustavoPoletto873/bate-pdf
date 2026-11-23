import { responder } from '@/lib/api';
import { acompanhamentoLotes } from '@/lib/anexo/acompanhamento';
import { iniciarFila } from '@/lib/anexo/fila';

export const dynamic = 'force-dynamic';

/** Acompanhamento de Lotes: jobs pendentes/processando por base e os documentos com erro. ?pagina&por_pagina */
export async function GET(request: Request) {
  return responder(async () => {
    await iniciarFila();
    const p = new URL(request.url).searchParams;
    return Response.json(await acompanhamentoLotes({ pagina: Number(p.get('pagina')) || 1, porPagina: Number(p.get('por_pagina')) || 10 }));
  });
}
