import { ErroDeUso, responder } from '@/lib/api';
import { obterClienteGemini } from '@/lib/ia/cliente';
import { modeloGemini } from '@/lib/ia/config';
import { amostraDoTipo, pdfDoDocumento, testarExtracao } from '@/lib/treino';
import { lerFormularioTipo } from '../comum';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Testa a extração com a configuração (multipart: config + amostra, ou documento_id de um
 * documento para treinar, ou tipo_id para reaproveitar o exemplo salvo). Chama o Gemini.
 */
export async function POST(request: Request) {
  return responder(async () => {
    const f = await lerFormularioTipo(request);
    const pdf = f.amostra ?? (f.documentoId ? pdfDoDocumento(f.documentoId).bytes : f.tipoId ? amostraDoTipo(f.tipoId) : null);
    if (!pdf) throw new ErroDeUso('Envie um PDF de exemplo (ou escolha um documento da fila) para testar.');
    return Response.json(await testarExtracao(pdf, f.config, { cliente: obterClienteGemini, modelo: modeloGemini() }));
  });
}
