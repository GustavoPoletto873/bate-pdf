import { ErroDeUso, responder } from '@/lib/api';
import { backupDaBase, linhasParaExportar, obterBase } from '@/lib/repo';
import { gerarPlanilhaResultados, nomeDoArquivo } from '@/lib/planilha/exportar';

export const dynamic = 'force-dynamic';

/**
 * ?formato=xlsx (padrão): resultados_matching igual ao "Exportar para Excel" de Resultados do Bate
 *   Lastro (vínculos e pré-bates com STATUS V, o resto P), que o "Inserir Resultado" de lá lê.
 *   &pendentes=0 deixa de fora os títulos ainda pendentes (o importador ignora STATUS P).
 * ?formato=json: backup completo da base (títulos, marcações, vínculos e PDFs).
 */
export async function GET(request: Request, ctx: RouteContext<'/api/bases/[id]/exportar'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const base = await obterBase(id);
    if (!base) throw new ErroDeUso('Base não encontrada.', 404);
    const params = new URL(request.url).searchParams;
    const agora = new Date();
    if (params.get('formato') === 'json') {
      const nome = `bate-pdf_${(base.nome_fundo ?? base.nome).replace(/[^\w-]+/g, '_')}_${agora.toISOString().slice(0, 10)}.json`;
      return new Response(JSON.stringify(await backupDaBase(id), null, 2), {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(nome)}`,
        },
      });
    }
    const linhas = await linhasParaExportar(id, { incluirPendentes: params.get('pendentes') !== '0' });
    const bytes = await gerarPlanilhaResultados(linhas, {
      nome: base.nome, cnpj: base.cnpj_fundo, geradoEm: agora, nomeFundo: base.nome_fundo, dataReferencia: base.data_referencia,
    });
    const nome = nomeDoArquivo(base.cnpj_fundo, agora);
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nome}"`,
      },
    });
  });
}
