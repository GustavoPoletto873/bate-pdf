import { ErroDeUso, responder } from '@/lib/api';
import { filtrosDaUrl, MAX_LINHAS_EXCEL, planilhaDasLeituras, todasAsLeituras } from '@/lib/anexo/visualizar';

export const dynamic = 'force-dynamic';

/** Exportar Excel: todas as leituras filtradas (?<filtros>&colunas=NOME_SACADO,…). */
export async function GET(request: Request) {
  return responder(async () => {
    const p = new URL(request.url).searchParams;
    const filtros = filtrosDaUrl(p);
    const linhas = todasAsLeituras(filtros, { ordenarPor: p.get('ordenar') ?? undefined, direcao: p.get('direcao') ?? undefined });
    if (!linhas.length) throw new ErroDeUso('Não há dados para exportar.');
    if (linhas.length > MAX_LINHAS_EXCEL) throw new ErroDeUso('São mais linhas do que cabem numa planilha do Excel. Use filtros para diminuir.');
    const colunas = (p.get('colunas') ?? '').split(',').filter(Boolean);
    const bytes = await planilhaDasLeituras(linhas, colunas);
    const carimbo = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, '');
    const nome = `${Object.keys(filtros).length ? 'resultados_filtrados' : 'todos_resultados'}_${carimbo}.xlsx`;
    return new Response(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${nome}"`,
      },
    });
  });
}
