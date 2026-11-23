import { responder } from '@/lib/api';
import { lerStatus, listarAuditorias } from './selecao';

export const dynamic = 'force-dynamic';

/**
 * Seleção de Auditoria: ?busca=&tipo=trimestre|data&ano=&trimestre=&data=&status=&pagina=&por_pagina=
 * → contagem por status (com busca e período) e os cartões do status pedido, 16 por página.
 */
export async function GET(request: Request) {
  return responder(async () => {
    const p = new URL(request.url).searchParams;
    const tipo = p.get('tipo');
    return Response.json(await listarAuditorias({
      busca: p.get('busca'),
      tipo: tipo === 'trimestre' || tipo === 'data' ? tipo : null,
      ano: p.get('ano'),
      trimestre: p.get('trimestre'),
      data: p.get('data'),
      status: lerStatus(p.get('status')),
      pagina: Number(p.get('pagina')) || 1,
      por_pagina: Number(p.get('por_pagina')) || 16,
    }));
  });
}
