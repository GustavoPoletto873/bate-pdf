import { responder } from '@/lib/api';
import { filtrarFundos } from '@/lib/fundos';
import { filtroDaUrl } from '../filtro';

export const dynamic = 'force-dynamic';

/** Ids de todos os fundos do filtro, para "selecionar todos" valer além da página. */
export async function GET(request: Request) {
  return responder(async () => Response.json({ ids: (await filtrarFundos(filtroDaUrl(new URL(request.url)))).map((f) => f.id) }));
}
