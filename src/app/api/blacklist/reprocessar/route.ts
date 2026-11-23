import { responder } from '@/lib/api';
import { reprocessar } from '@/lib/blacklist';

export const dynamic = 'force-dynamic';

/** Confere todas as entidades contra todas as bases de novo. */
export async function POST() {
  return responder(async () => Response.json(await reprocessar()));
}
