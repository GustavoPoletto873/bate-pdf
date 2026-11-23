import { ErroDeUso, responder } from '@/lib/api';
import { lerModoReferencia } from '@/lib/upload-base/datas';
import { uploadsRecentes } from '@/lib/upload-base/registrar';

export const dynamic = 'force-dynamic';

/** Bases do mesmo fundo e período criadas nos últimos 30 minutos (?fundo_id=&data_referencia=&modo_referencia=). */
export async function GET(request: Request) {
  return responder(async () => {
    const p = new URL(request.url).searchParams;
    const modo = lerModoReferencia(p.get('modo_referencia'));
    if (!modo) throw new ErroDeUso('Modo de referência inválido. Use trimestre ou data.');
    return Response.json(await uploadsRecentes({
      fundo_id: Number(p.get('fundo_id')),
      data_referencia: p.get('data_referencia') ?? '',
      modo,
      minutos: Number(p.get('minutos')) || 30,
    }));
  });
}
