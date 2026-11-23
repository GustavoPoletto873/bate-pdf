'use client';

/**
 * Na versão na nuvem, os arquivos de um FormData vão antes direto para o Vercel Blob (o corpo de
 * uma requisição na Vercel tem limite de ~4,5 MB) e o formulário leva só a referência; o servidor
 * devolve os arquivos com `lerFormulario` (lib/envio.ts). Na versão local nada muda.
 */
export const NUVEM = process.env.NEXT_PUBLIC_LASTRO_NUVEM === '1';

async function subir(arquivo: File): Promise<string> {
  const { upload } = await import('@vercel/blob/client');
  const limpo = arquivo.name.replace(/[\\/]+/g, '_').slice(-180) || 'arquivo';
  const r = await upload(`uploads/${crypto.randomUUID()}/${limpo}`, arquivo, {
    access: 'private',
    handleUploadUrl: '/api/arquivos/enviar',
    multipart: arquivo.size > 20 * 1024 * 1024,
  });
  return JSON.stringify({ __blob: r.pathname, nome: arquivo.name, tipo: arquivo.type });
}

/** O mesmo formulário, com cada arquivo trocado pela referência no Blob (4 envios por vez). */
export async function formularioParaNuvem(form: FormData): Promise<FormData> {
  if (!NUVEM) return form;
  const entradas = [...form.entries()];
  if (!entradas.some(([, v]) => typeof v !== 'string')) return form;
  const prontos: (string | File)[] = entradas.map(([, v]) => v);
  let proximo = 0;
  const trabalhar = async () => {
    for (let i = proximo++; i < entradas.length; i = proximo++) {
      const v = entradas[i][1];
      if (typeof v !== 'string') prontos[i] = await subir(v);
    }
  };
  await Promise.all(Array.from({ length: 4 }, trabalhar));
  const saida = new FormData();
  entradas.forEach(([campo], i) => saida.append(campo, prontos[i]));
  return saida;
}
