import { ErroDeUso, responder } from '@/lib/api';
import { gerar, listar } from '@/lib/amostra/servico';
import { arquivosDo, dataDo, inteiroDo, regraDo, textoDo } from '@/lib/amostra/formulario';

export const dynamic = 'force-dynamic';

/** Histórico (com as descartadas): ?fundo_id=&limite= */
export async function GET(request: Request) {
  return responder(() => {
    const p = new URL(request.url).searchParams;
    const fundoId = p.get('fundo_id') ? Number(p.get('fundo_id')) : null;
    const limite = Math.min(200, Math.max(1, Number(p.get('limite') ?? 50) || 50));
    return Response.json({ items: listar(fundoId, limite) });
  });
}

/**
 * Sorteia a amostra do fundo com uma seed nova e registra tudo (multipart):
 * fundo_id, data_de, data_ate, limite_adquiridos, limite_vencidos, regra (padrao|planner),
 * estoques[], liquidados[], amostra_anterior (arquivo) ou amostra_anterior_id, motivo (no 409).
 */
export async function POST(request: Request) {
  return responder(async () => {
    const form = await request.formData();
    const fundoId = inteiroDo(form, 'fundo_id');
    if (!fundoId) throw new ErroDeUso('Escolha o fundo.');
    const total = { bytes: 0 };
    const estoques = await arquivosDo(form, 'estoques', total);
    if (!estoques.length) throw new ErroDeUso('Envie pelo menos um arquivo de estoque.');
    const liquidados = await arquivosDo(form, 'liquidados', total);
    const [anterior] = await arquivosDo(form, 'amostra_anterior', total);
    const amostra = await gerar({
      fundoId,
      dataDe: dataDo(form, 'data_de', 'data de início')!,
      dataAte: dataDo(form, 'data_ate', 'data fim')!,
      limiteAdquiridos: inteiroDo(form, 'limite_adquiridos', 120)!,
      limiteVencidos: inteiroDo(form, 'limite_vencidos', 120)!,
      regra: regraDo(form),
      estoques,
      liquidados,
      amostraAnterior: anterior ?? null,
      amostraAnteriorId: inteiroDo(form, 'amostra_anterior_id'),
      motivo: textoDo(form, 'motivo'),
    });
    return Response.json(amostra, { status: 201 });
  });
}
