import { responder } from '@/lib/api';
import { criarTipo, listarDesativados, listarTipos, pdfDoDocumento } from '@/lib/treino';
import { lerFormularioTipo } from '../comum';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  return responder(() => Response.json({ itens: listarTipos(new URL(request.url).searchParams.get('busca')), desativados: listarDesativados() }));
}

/** Novo tipo (multipart: config + amostra ou documento_id). Exige o teste da mesma config. */
export async function POST(request: Request) {
  return responder(async () => {
    const f = await lerFormularioTipo(request);
    const amostra = f.amostra ?? (f.documentoId ? pdfDoDocumento(f.documentoId).bytes : null);
    return Response.json({ tipo: criarTipo(f.config, amostra) }, { status: 201 });
  });
}
