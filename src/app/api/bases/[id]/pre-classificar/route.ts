import { ErroDeUso, responder } from '@/lib/api';
import { entradaDoMotor, obterPreClassificacao, salvarPreClassificacao } from '@/lib/repo';
import { preClassificar, regrasDoFundoDaAmostra } from '@/lib/motor';

export const maxDuration = 1800;

type Global = typeof globalThis & { __batePdfPreEmCurso?: Map<string, Promise<unknown>> };

/**
 * Roda o motor na base inteira (só lê; não grava marcação nem vínculo). Duas
 * pessoas clicando ao mesmo tempo na mesma base compartilham uma execução, como
 * no Bate Lastro (asyncio.shield por cliente+base).
 */
export async function POST(_req: Request, ctx: RouteContext<'/api/bases/[id]/pre-classificar'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const g = globalThis as Global;
    g.__batePdfPreEmCurso ??= new Map();
    let execucao = g.__batePdfPreEmCurso.get(id);
    if (!execucao) {
      execucao = (async () => {
        // Deixa a resposta de quem chamou sair do laço antes do trabalho pesado.
        await new Promise((ok) => setTimeout(ok, 0));
        const inicio = Date.now();
        const entrada = entradaDoMotor(id);
        if (!entrada.base) throw new ErroDeUso('Base não encontrada.', 404);
        if (!entrada.paginas.length) throw new ErroDeUso('Nenhum PDF com texto nesta base ainda. Envie os PDFs e espere a indexação.');
        const resultado = preClassificar({
          pendencias: entrada.pendencias,
          paginas: entrada.paginas,
          tiposPdf: entrada.tiposPdf,
          pdfsComLastro: entrada.pdfsComLastro,
          vinculos: entrada.vinculos as never,
          outrasBases: entrada.outrasBases,
          regrasFundo: regrasDoFundoDaAmostra(entrada.amostra, entrada.base.administradora),
        });
        const completo = { ...resultado, nomes_pdfs: entrada.nomesPdfs };
        const duracao = Date.now() - inicio;
        salvarPreClassificacao(id, completo, duracao);
        return obterPreClassificacao(id);
      })().finally(() => g.__batePdfPreEmCurso!.delete(id));
      g.__batePdfPreEmCurso.set(id, execucao);
    }
    return Response.json(await execucao);
  });
}

export async function GET(_req: Request, ctx: RouteContext<'/api/bases/[id]/pre-classificar'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    return Response.json(obterPreClassificacao(id));
  });
}
