import { ErroDeUso } from '@/lib/api';
import { lerFormulario } from '@/lib/envio';

export type FormularioTipo = { config: unknown; amostra: Uint8Array | null; versao: number | null; documentoId: number | null; tipoId: number | null };

/** Lê o multipart da tela de tipos: `config` (JSON) e o PDF de exemplo (`amostra`, `documento_id` ou `tipo_id`). */
export async function lerFormularioTipo(request: Request): Promise<FormularioTipo> {
  let form: FormData;
  try {
    form = await lerFormulario(request);
  } catch {
    throw new ErroDeUso('Envie o formulário do tipo (config e PDF de exemplo).');
  }
  let config: unknown;
  try {
    config = JSON.parse(String(form.get('config') ?? ''));
  } catch {
    throw new ErroDeUso('Não foi possível processar a configuração enviada.', 422);
  }
  const arquivo = form.get('amostra');
  const amostra = arquivo instanceof File && arquivo.size ? new Uint8Array(await arquivo.arrayBuffer()) : null;
  const numero = (nome: string) => {
    const v = form.get(nome);
    return v === null || v === '' ? null : Number(v);
  };
  return { config, amostra, versao: numero('versao'), documentoId: numero('documento_id'), tipoId: numero('tipo_id') };
}
