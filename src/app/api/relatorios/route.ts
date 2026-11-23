import { responder } from '@/lib/api';
import { fundosParaEmissao, historico, trimestresDisponiveis } from '@/lib/relatorios/relatorios';

export const dynamic = 'force-dynamic';

/** Trimestres, fundos com o estado de emissão na data-base (?data_base=) e o histórico. */
export async function GET(request: Request) {
  return responder(() => {
    const url = new URL(request.url);
    const trimestres = trimestresDisponiveis();
    const dataBase = url.searchParams.get('data_base') || trimestres[0]?.datas_base[0]?.data_base || null;
    return Response.json({
      trimestres,
      data_base: dataBase,
      fundos: dataBase ? fundosParaEmissao(dataBase, url.searchParams.get('busca')) : [],
      historico: historico(),
    });
  });
}
