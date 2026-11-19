import { PlanilhaRecusada } from '@/lib/planilha/importar';

/** Erro com mensagem para a pessoa (vai direto para a tela). */
export class ErroDeUso extends Error {
  constructor(mensagem: string, public status = 400) {
    super(mensagem);
  }
}

/** Envolve o handler: erro de uso vira JSON {erro} com a mensagem; o resto, 500 genérico. */
export async function responder(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof ErroDeUso) return Response.json({ erro: e.message }, { status: e.status });
    if (e instanceof PlanilhaRecusada) return Response.json({ erro: e.message }, { status: 422 });
    console.error(e);
    return Response.json(
      { erro: 'Algo deu errado no servidor do Bate PDF. Tente de novo; se repetir, veja o terminal onde o app está rodando.' },
      { status: 500 },
    );
  }
}

export async function lerJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ErroDeUso('Requisição sem JSON válido.');
  }
}
