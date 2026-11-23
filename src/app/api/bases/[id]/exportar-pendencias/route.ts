import { ErroDeUso, responder } from '@/lib/api';
import { obterBase } from '@/lib/repo';
import { pendenciasParaExportar } from '@/lib/bates/resultados';
import { nomeDoArquivoPendencias, planilhaPendencias, planilhaPendenciasConsolidada } from '@/lib/bates/exportarPendencias';

export const dynamic = 'force-dynamic';

/** Exportar pendências: ?layout=1 (por documento faltante, padrão) | 2 (consolidado por título). */
export async function GET(request: Request, ctx: RouteContext<'/api/bases/[id]/exportar-pendencias'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const base = await obterBase(id);
    if (!base) throw new ErroDeUso('Base não encontrada.', 404);
    const layout = new URL(request.url).searchParams.get('layout') ?? '1';
    if (layout !== '1' && layout !== '2') throw new ErroDeUso('Layout inválido. Selecione o layout 1 ou 2.');
    const p = await pendenciasParaExportar(id);
    const primeiro = p.consolidadas[0]?.titulo;
    const fundo = {
      nome_fundo: base.nome_fundo ?? primeiro?.nome_fundo ?? null,
      cnpj_fundo: base.cnpj_fundo ?? primeiro?.cnpj_fundo ?? null,
      data_referencia: base.data_referencia,
    };
    const bytes = layout === '1' ? await planilhaPendencias(fundo, p.faltantes) : await planilhaPendenciasConsolidada(p.consolidadas);
    const nome = nomeDoArquivoPendencias(fundo);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`,
      },
    });
  });
}
