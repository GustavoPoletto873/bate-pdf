import { redirect } from 'next/navigation';
import { DOMINIO, loginAtivo, signIn } from '@/auth';
import { LogoLastro } from '@/components/LogoLastro';
import { Aviso, Botao } from '@/components/ui';

export const dynamic = 'force-dynamic';

/** Só caminhos do próprio app (nada de //outro-site). */
const destino = (v: string | string[] | undefined) => {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/entrar') ? s : '/';
};

export default async function Entrar({ searchParams }: PageProps<'/entrar'>) {
  const params = await searchParams;
  const voltar = destino(params.voltar ?? params.callbackUrl);
  if (!loginAtivo()) redirect(voltar);
  const erro = params.error;

  async function entrar() {
    'use server';
    await signIn('google', { redirectTo: voltar });
  }

  return (
    <div className="flex flex-1 items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-6 text-center">
        <div className="flex justify-center"><LogoLastro tamanho={48} /></div>
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold">Entrar no Lastro</h1>
          <p className="font-serif text-slate-600 dark:text-slate-400">
            Use a sua conta Google <span className="font-mono text-sm">@{DOMINIO}</span>.
          </p>
        </div>
        {erro && (
          <Aviso tipo="erro">
            {erro === 'AccessDenied'
              ? `Só contas @${DOMINIO} entram. Escolha a conta da empresa.`
              : 'Não foi possível entrar agora. Tente de novo.'}
          </Aviso>
        )}
        <form action={entrar}>
          <Botao type="submit" variante="primario" className="w-full justify-center">Entrar com o Google</Botao>
        </form>
      </div>
    </div>
  );
}
