import { responder } from '@/lib/api';
import { gerarModeloFundos } from '@/lib/fundos';

export const dynamic = 'force-dynamic';

/** "Baixar modelo" da importação de fundos (abas Fundos e Administradores). */
export async function GET() {
  return responder(async () => {
    const bytes = await gerarModeloFundos();
    return new Response(bytes as unknown as BodyInit, {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="modelo_fundos.xlsx"',
      },
    });
  });
}
