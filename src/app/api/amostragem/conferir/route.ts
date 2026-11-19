import { ErroDeUso, responder } from '@/lib/api';
import { conferir } from '@/lib/amostra/servico';
import { arquivosDo, dataDo, inteiroDo, regraDo, textoDo } from '@/lib/amostra/formulario';

export const dynamic = 'force-dynamic';

/** Refaz a amostra de uma seed com o estoque enviado, sem registrar nada (multipart). */
export async function POST(request: Request) {
  return responder(async () => {
    const form = await request.formData();
    const seed = textoDo(form, 'seed');
    if (!seed) throw new ErroDeUso('Digite a seed (12 caracteres).');
    const total = { bytes: 0 };
    const estoques = await arquivosDo(form, 'estoques', total);
    const liquidados = await arquivosDo(form, 'liquidados', total);
    const [anterior] = await arquivosDo(form, 'amostra_anterior', total);
    return Response.json(await conferir(seed, estoques, {
      dataDe: dataDo(form, 'data_de', 'data de início', false),
      dataAte: dataDo(form, 'data_ate', 'data fim', false),
      limiteAdquiridos: inteiroDo(form, 'limite_adquiridos'),
      limiteVencidos: inteiroDo(form, 'limite_vencidos'),
      regra: regraDo(form),
      amostraAnterior: anterior ?? null,
      liquidados,
    }));
  });
}
