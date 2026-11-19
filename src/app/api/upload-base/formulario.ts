import { ErroDeUso } from '@/lib/api';
import { lerModoReferencia, type ModoReferencia } from '@/lib/upload-base/datas';

/** Campos comuns do formulário (multipart) do Upload Base. */
export async function lerFormulario(request: Request) {
  const form = await request.formData();
  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) throw new ErroDeUso('Escolha o arquivo da base (.xlsx ou .csv).');
  const campo = (n: string) => {
    const v = form.get(n);
    return typeof v === 'string' && v.trim() ? v.trim() : null;
  };
  const modo = lerModoReferencia(campo('modo_referencia'));
  if (!modo) throw new ErroDeUso('Modo de referência inválido. Use trimestre ou data.');
  const fundo = campo('fundo_id');
  return {
    arquivo: { nome: arquivo.name, conteudo: new Uint8Array(await arquivo.arrayBuffer()) },
    campo,
    modo: modo as ModoReferencia,
    fundo_id: fundo ? Number(fundo) : null,
  };
}
