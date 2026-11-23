'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { Cabecalho, CampoSenha, ErroAcesso, lerErro, RegrasSenha, SEM_CONEXAO, senhaForte, TelaAcesso, type ErroTela } from '@/components/acesso/Campos';
import { ConfigurarAuthenticator, type DadosAuthenticator } from '@/components/acesso/ConfigurarAuthenticator';
import { Aviso, cx } from '@/components/ui';

interface InfoConvite {
  email: string;
  nome: string;
  tipo: 'cadastro' | 'redefinir';
  expira: string;
}

const BOTAO = 'lastro-botao lastro-botao-md w-full justify-center';

// O token vem depois do # (#t=...): o navegador não manda essa parte ao servidor.
function assinarHash(aviso: () => void) {
  window.addEventListener('hashchange', aviso);
  return () => window.removeEventListener('hashchange', aviso);
}
function tokenDoHash(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';
}

/** Link de convite (ou de redefinição): cria a senha, configura o authenticator e já entra. */
export function FormularioConvite() {
  const router = useRouter();
  const token = useSyncExternalStore(assinarHash, tokenDoHash, () => '');
  const montado = useSyncExternalStore(() => () => {}, () => true, () => false);
  const [info, setInfo] = useState<InfoConvite | null>(null);
  const [falhaLink, setFalhaLink] = useState<string | null>(null);
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [mfa, setMfa] = useState<DadosAuthenticator | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<ErroTela>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!token) return;
    let vivo = true;
    fetch('/api/auth/convite', { cache: 'no-store', headers: { 'x-convite': token } })
      .then(async (r) => {
        if (!vivo) return;
        if (r.ok) setInfo((await r.json()) as InfoConvite);
        else setFalhaLink((await lerErro(r)).mensagem);
      })
      .catch(() => vivo && setFalhaLink(SEM_CONEXAO.mensagem));
    return () => {
      vivo = false;
    };
  }, [token]);

  async function postar(corpo: object): Promise<Response | null> {
    try {
      return await fetch('/api/auth/convite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, ...corpo }) });
    } catch {
      setErro(SEM_CONEXAO);
      return null;
    }
  }

  async function enviarSenha(e: React.FormEvent) {
    e.preventDefault();
    if (!senhaForte(senha) || senha !== confirmar) return;
    setOcupado(true);
    setErro(null);
    const r = await postar({ etapa: 'senha', senha });
    if (r?.ok) {
      setMfa((await r.json()) as DadosAuthenticator);
      setSenha('');
      setConfirmar('');
    } else if (r) setErro(await lerErro(r));
    setOcupado(false);
  }

  async function enviarCodigo(codigo: string) {
    setOcupado(true);
    setErro(null);
    const r = await postar({ etapa: 'codigo', codigo });
    if (r?.ok) {
      router.replace('/');
      router.refresh();
      return;
    }
    if (r) setErro(await lerErro(r));
    setTentativa((t) => t + 1);
    setOcupado(false);
  }

  const problemaLink = falhaLink ?? (montado && !token ? 'Link incompleto. Abra o link inteiro que você recebeu (ele termina com #t=…).' : null);

  if (problemaLink) {
    return (
      <TelaAcesso>
        <Cabecalho titulo="Link de acesso" />
        <Aviso tipo="erro">{problemaLink}</Aviso>
        <Link className={`${BOTAO} lastro-botao-secundario`} href="/entrar">Ir para a tela de entrar</Link>
      </TelaAcesso>
    );
  }

  if (!info) return <TelaAcesso><div className="min-h-64" aria-busy="true" /></TelaAcesso>;

  const redefinir = info.tipo === 'redefinir';
  const expira = new Date(info.expira).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

  return (
    <TelaAcesso largo>
      <Cabecalho titulo={redefinir ? 'Redefinir acesso' : `Olá, ${info.nome.split(' ')[0]}`}>
        {redefinir
          ? 'Crie uma senha nova e configure o authenticator de novo. Seu acesso antigo deixa de valer quando você terminar.'
          : 'Crie a sua senha e configure o authenticator para entrar no Lastro.'}{' '}
        Conta: <strong>{info.email}</strong>. Link válido até {expira}.
      </Cabecalho>

      <ol className="flex justify-center gap-6 text-sm" aria-label="Etapas">
        {['Senha', 'Authenticator'].map((rotulo, i) => {
          const atual = (i === 0) === !mfa;
          return (
            <li key={rotulo} className={cx('flex items-center gap-2', atual ? 'font-bold' : 'text-slate-500 dark:text-slate-400')} aria-current={atual ? 'step' : undefined}>
              <span className={cx('grid size-6 place-items-center rounded-full border-2 text-xs', atual ? 'border-slate-900 dark:border-slate-200' : 'border-slate-300 dark:border-slate-700')}>{i + 1}</span>
              {rotulo}
            </li>
          );
        })}
      </ol>

      {!mfa ? (
        <>
          <ErroAcesso erro={erro} />
          <form className="space-y-4" onSubmit={enviarSenha}>
            {/* campo de usuário (escondido) para o gerenciador de senhas salvar a senha com o e-mail certo */}
            <input type="email" autoComplete="username" value={info.email} readOnly hidden />
            <CampoSenha rotulo="Nova senha" valor={senha} aoMudar={setSenha} autoComplete="new-password" autoFocus descritoPor="regras-senha" />
            <RegrasSenha senha={senha} id="regras-senha" />
            <CampoSenha rotulo="Repita a senha" valor={confirmar} aoMudar={setConfirmar} autoComplete="new-password" />
            {confirmar && senha !== confirmar && <p className="text-xs text-rose-700 dark:text-rose-400">As duas senhas estão diferentes.</p>}
            <button className={`${BOTAO} lastro-botao-primario`} type="submit" disabled={ocupado || !senhaForte(senha) || senha !== confirmar}>
              {ocupado ? 'Salvando…' : 'Continuar'}
            </button>
          </form>
        </>
      ) : (
        <ConfigurarAuthenticator dados={mfa} aoConfirmar={enviarCodigo} ocupado={ocupado} tentativa={tentativa} erro={<ErroAcesso erro={erro} />} />
      )}
    </TelaAcesso>
  );
}
