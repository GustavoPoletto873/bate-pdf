import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { lerDeNovo } from '@/lib/anexo/lotes';
import { decidir, desfazer, marcarTreinados, moverParaGrupo } from '@/lib/treino';

export const dynamic = 'force-dynamic';

type Corpo = { acao?: string; ids?: number[]; grupo?: string | null; tipo_documento_id?: number };

/**
 * Ações sobre os documentos para treinar:
 * separar (com grupo), ignorar, mover de grupo, desfazer, marcar treinados e ler de novo.
 */
export async function POST(request: Request) {
  return responder(async () => {
    const b = await lerJson<Corpo>(request);
    switch (b.acao) {
      case 'separar': return Response.json({ alterados: decidir(b.ids, 'separado', b.grupo) });
      case 'ignorar': return Response.json({ alterados: decidir(b.ids, 'ignorado') });
      case 'grupo': return Response.json({ alterados: moverParaGrupo(b.ids, b.grupo) });
      case 'desfazer': return Response.json({ alterados: desfazer(b.ids) });
      case 'treinados': return Response.json({ alterados: marcarTreinados(b.ids, Number(b.tipo_documento_id)) });
      case 'ler_de_novo': {
        if (!b.ids?.length) throw new ErroDeUso('Selecione ao menos um documento.');
        return Response.json({ alterados: lerDeNovo(b.ids.map(Number)) });
      }
      default: throw new ErroDeUso('Ação desconhecida.');
    }
  });
}
