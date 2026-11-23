import { responder } from '@/lib/api';
import { basesComChaves, credenciaisSerpro, filtroDaUrl, listarNotas } from '@/lib/notasFiscais';

export const dynamic = 'force-dynamic';

/** Lista paginada + resumo (GET /v1/acompanhamento-nota-fiscal do Bate Lastro). */
export async function GET(request: Request) {
  return responder(async () => {
    const url = new URL(request.url);
    return Response.json({
      ...(await listarNotas({ ...filtroDaUrl(url), pagina: Number(url.searchParams.get('pagina')) || 1, tamanho: Number(url.searchParams.get('tamanho')) || 20 })),
      bases: await basesComChaves(),
      serpro_configurado: credenciaisSerpro() !== null,
    });
  });
}
