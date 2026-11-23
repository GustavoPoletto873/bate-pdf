import { ErroDeUso, responder } from '@/lib/api';
import { administradoras, painel } from '@/lib/dashboard';

export const dynamic = 'force-dynamic';

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Painel de auditoria: ?de=AAAA-MM-DD&ate=AAAA-MM-DD&administradora_id= (sem datas = histórico completo). */
export async function GET(request: Request) {
  return responder(async () => {
    const p = new URL(request.url).searchParams;
    const de = p.get('de') || null;
    const ate = p.get('ate') || null;
    if ((de && !DATA.test(de)) || (ate && !DATA.test(ate))) throw new ErroDeUso('Datas do período no formato AAAA-MM-DD.');
    if (de && ate && de > ate) throw new ErroDeUso('A data final não pode ser anterior à data inicial.');
    const adm = p.get('administradora_id');
    return Response.json({
      ...(await painel({ de, ate, administradoraId: adm ? Number(adm) : null })),
      administradoras: await administradoras(),
    });
  });
}
