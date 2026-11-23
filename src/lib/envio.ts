import { apagarArquivo, lerArquivo } from '@/lib/arquivos';

const REFERENCIA = /^uploads\/[0-9a-f-]{36}\/[^/]+$/;

/**
 * O FormData de uma requisição, com os arquivos de volta. Na versão na nuvem o navegador manda
 * cada arquivo antes direto para o Vercel Blob (lib/cliente/envio.ts) e o formulário leva só a
 * referência; aqui o arquivo é lido do Blob (e o temporário apagado), então as rotas continuam
 * recebendo `File` como na versão local.
 */
export async function lerFormulario(request: Request): Promise<FormData> {
  const form = await request.formData();
  const saida = new FormData();
  const temporarios: string[] = [];
  for (const [campo, v] of form.entries()) {
    if (typeof v === 'string' && v.startsWith('{"__blob":')) {
      let ref: { __blob?: string; nome?: string; tipo?: string };
      try { ref = JSON.parse(v); } catch { saida.append(campo, v); continue; }
      if (!ref.__blob || !REFERENCIA.test(ref.__blob)) throw new Error('Referência de arquivo inválida.');
      const bytes = await lerArquivo(ref.__blob);
      if (!bytes) throw new Error('O arquivo enviado não chegou ao armazenamento. Envie de novo.');
      temporarios.push(ref.__blob);
      saida.append(campo, new File([bytes as Uint8Array<ArrayBuffer>], ref.nome ?? ref.__blob.split('/').pop()!, { type: ref.tipo ?? '' }));
    } else {
      saida.append(campo, v);
    }
  }
  // Já está na memória: o temporário pode sair do Blob.
  await Promise.all(temporarios.map((t) => apagarArquivo(t).catch(() => undefined)));
  return saida;
}
