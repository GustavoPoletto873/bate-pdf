import { responder } from '@/lib/api';
import { previaResultados, registrarResultados } from '@/lib/upload-base/registrar';
import { lerFormulario } from '../formulario';

export const dynamic = 'force-dynamic';

/**
 * Contingência: base a partir do resultados_matching_*.xlsx do Bate Lastro (multipart).
 * previa=1 só lê e resume; sem ele, cria a base (fundo_id e data_referencia opcionais).
 */
export async function POST(request: Request) {
  return responder(async () => {
    const { arquivo, campo, modo, fundo_id } = await lerFormulario(request);
    if (campo('previa') === '1') return Response.json(await previaResultados(arquivo.conteudo, arquivo.nome));
    const base = await registrarResultados({ arquivo, fundo_id, data_referencia: campo('data_referencia'), modo });
    return Response.json(base, { status: 201 });
  });
}
