import { responder } from '@/lib/api';
import { basesComChaves, credenciaisSerpro, filtroDaUrl, listarNotas } from '@/lib/notasFiscais';

export const dynamic = 'force-dynamic';

/** Lista paginada + resumo (GET /v1/acompanhamento-nota-fiscal do Bate Lastro). */
export async function GET(request: Request) {
  return responder(() => {
    const url = new URL(request.url);
    return Response.json({
      ...listarNotas({ ...filtroDaUrl(url), pagina: Number(url.searchParams.get('pagina')) || 1, tamanho: Number(url.searchParams.get('tamanho')) || 20 }),
      bases: basesComChaves(),
      serpro_configurado: credenciaisSerpro() !== null,
    });
  });
}
