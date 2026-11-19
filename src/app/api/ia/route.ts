import { responder } from '@/lib/api';
import { db } from '@/lib/db';
import { statusGemini } from '@/lib/ia/config';

export const dynamic = 'force-dynamic';

/** Situação da leitura por IA: se a chave existe (nunca a chave), o modelo e o uso registrado. */
export async function GET() {
  return responder(() => {
    const uso = db().prepare(`SELECT COUNT(*) chamadas, COALESCE(SUM(tokens_entrada), 0) entrada, COALESCE(SUM(tokens_saida), 0) saida,
      COALESCE(SUM(custo_usd), 0) custo FROM uso_ia`).get() as { chamadas: number; entrada: number; saida: number; custo: number };
    return Response.json({ ...statusGemini(), uso });
  });
}
