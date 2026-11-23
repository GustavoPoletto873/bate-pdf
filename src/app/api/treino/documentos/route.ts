import { responder } from '@/lib/api';
import { listarCandidatos, resumoTreino } from '@/lib/treino';

export const dynamic = 'force-dynamic';

/** Documentos que a IA não leu (outro documento / intervenção humana), com a decisão de cada um. */
export async function GET(request: Request) {
  return responder(async () => {
    const u = new URL(request.url).searchParams;
    return Response.json({
      ...(await listarCandidatos({ baseId: u.get('base'), pendentes: u.get('pendentes') === '1', busca: u.get('busca'), pagina: Number(u.get('pagina')) || 1 })),
      resumo: await resumoTreino(),
    });
  });
}
