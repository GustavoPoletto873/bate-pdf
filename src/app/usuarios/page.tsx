import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Usuarios } from '@/components/acesso/Usuarios';
import { Pagina } from '@/components/Pagina';
import { Aviso } from '@/components/ui';
import { loginObrigatorio } from '@/lib/auth/config';
import { quemEsta } from '@/lib/auth/requisicao';

export const dynamic = 'force-dynamic';

/** Perfil › Usuários: contas do Lastro (só administradores). */
export default async function PaginaUsuarios() {
  const login = loginObrigatorio();
  const quem = login ? await quemEsta() : null;
  if (login && !quem) redirect('/entrar?voltar=/usuarios');
  return (
    <Pagina
      titulo="Usuários"
      subtitulo="Quem entra no Lastro, como no Bate Lastro: e-mail + senha + código do authenticator. As contas são criadas por convite."
      voltar={<Link href="/perfil">← Perfil</Link>}
      largura="max-w-5xl"
    >
      {!login ? (
        <Aviso tipo="info">
          O login está desligado neste computador (versão local, sem <code>SESSAO_SEGREDO</code>): não há contas para administrar.
        </Aviso>
      ) : quem?.perfil !== 'admin' ? (
        <Aviso tipo="alerta">Só administradores do Lastro gerenciam as contas.</Aviso>
      ) : (
        <Usuarios />
      )}
    </Pagina>
  );
}
