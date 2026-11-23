import { lerJson, responder } from '@/lib/api';
import { criarFundo, filtrarFundos, listarFundos, type DadosFundo } from '@/lib/fundos';
import { filtroDaUrl } from './filtro';

export const dynamic = 'force-dynamic';

/**
 * Lista os fundos: paginado (?pagina=&por_pagina=, 20 por página) ou todos de uma vez com ?todos=1
 * (para as listas de escolha das outras telas).
 */
export async function GET(request: Request) {
  return responder(async () => {
    const url = new URL(request.url);
    const filtro = filtroDaUrl(url);
    if (url.searchParams.get('todos') === '1') {
      const itens = await filtrarFundos(filtro);
      return Response.json({ itens, total: itens.length, pagina: 1, por_pagina: itens.length });
    }
    return Response.json(await listarFundos({
      ...filtro,
      pagina: Number(url.searchParams.get('pagina')) || 1,
      por_pagina: Number(url.searchParams.get('por_pagina')) || 20,
    }));
  });
}

export async function POST(request: Request) {
  return responder(async () => {
    const dados = await lerJson<DadosFundo>(request);
    return Response.json({ fundo: await criarFundo(dados) }, { status: 201 });
  });
}
