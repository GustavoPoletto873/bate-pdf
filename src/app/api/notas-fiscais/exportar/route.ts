import { responder } from '@/lib/api';
import { exportarNotas, filtroDaUrl } from '@/lib/notasFiscais';

export const dynamic = 'force-dynamic';

/** Excel com as notas do filtro (Exportar Todas / Ativas / Canceladas). */
export async function GET(request: Request) {
  return responder(async () => {
    const filtro = filtroDaUrl(new URL(request.url));
    const buffer = await exportarNotas(filtro);
    const sufixo = filtro.status ? `_${filtro.status}s` : '';
    const nome = `notas_fiscais${sufixo}_${new Date().toISOString().slice(0, 10)}.xlsx`;
    return new Response(new Uint8Array(buffer), {
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${nome}"` },
    });
  });
}
