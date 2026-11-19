import { ErroDeUso, lerJson, responder } from '@/lib/api';
import { salvarMarcacoes, type OperacaoMarcacao } from '@/lib/repo';
import { CAMPO_POR_ID } from '@/lib/campos';

/** Grava V/D/P em lote: { operacoes: [{pendencia_id, campo, valor, valor_digitado?, origem?}] }. */
export async function POST(request: Request, ctx: RouteContext<'/api/bases/[id]/marcacoes'>) {
  return responder(async () => {
    const { id } = await ctx.params;
    const { operacoes } = await lerJson<{ operacoes: OperacaoMarcacao[] }>(request);
    if (!Array.isArray(operacoes) || !operacoes.length) throw new ErroDeUso('Nenhuma marcação enviada.');
    for (const op of operacoes) {
      if (!CAMPO_POR_ID[op.campo]) throw new ErroDeUso(`Campo desconhecido: ${op.campo}`);
      if (op.valor !== null && !['V', 'D', 'P'].includes(op.valor)) throw new ErroDeUso('Marcação deve ser V, D ou P.');
    }
    return Response.json(salvarMarcacoes(id, operacoes));
  });
}
