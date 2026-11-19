import { ErroDeUso, responder } from '@/lib/api';
import { MENSAGEM_DADOS_INVALIDOS, resumirErros } from '@/lib/upload-base/erros';
import { registrarBase } from '@/lib/upload-base/registrar';
import { lerFormulario } from './formulario';

export const dynamic = 'force-dynamic';

/**
 * "Processar Arquivo" (multipart): arquivo, fundo_id, data_referencia, modo_referencia
 * (TRIMESTRE | DATA_REFERENCIA) e mapeamento (JSON {coluna do arquivo: coluna padrão}).
 * Dados inválidos: 422 com { erro, detalhes: ErroValidacao[] }.
 */
export async function POST(request: Request) {
  return responder(async () => {
    const { arquivo, campo, modo, fundo_id } = await lerFormulario(request);
    if (!fundo_id) throw new ErroDeUso('Selecione o fundo.');
    let mapeamento: Record<string, string> | null = null;
    const textoMapa = campo('mapeamento');
    if (textoMapa) {
      try {
        mapeamento = JSON.parse(textoMapa);
      } catch {
        throw new ErroDeUso('O mapeamento das colunas veio num formato inválido. Volte ao mapeamento e tente de novo.');
      }
    }
    const r = await registrarBase({ fundo_id, data_referencia: campo('data_referencia') ?? '', modo, arquivo, mapeamento });
    if (!r.ok) return Response.json({ erro: resumirErros(r.erros), mensagem: MENSAGEM_DADOS_INVALIDOS, detalhes: r.erros }, { status: 422 });
    return Response.json(r.base, { status: 201 });
  });
}
