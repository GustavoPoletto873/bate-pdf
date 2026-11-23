'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useId, useState } from 'react';
import { ArrowLeft, Mail } from 'lucide-react';
import { Cabecalho, Campo, CampoCodigo, CampoSenha, ErroAcesso, lerErro, SEM_CONEXAO, TelaAcesso, type ErroTela } from '@/components/acesso/Campos';
import { Aviso } from '@/components/ui';
import { caminhoSeguro } from '@/lib/auth/caminho';

// Só mensagens desta tabela aparecem: o texto de ?erro= nunca vai direto para a tela.
const ERROS: Record<string, string> = {
  config: 'O login do Lastro ainda não foi configurado no servidor. Avise o responsável pelo app.',
};

const BOTAO = 'lastro-botao lastro-botao-md w-full justify-center';

/** Entrar como no Bate Lastro: e-mail + senha → código do authenticator. */
export function FormularioEntrar({ loginLigado }: { loginLigado: boolean }) {
  const router = useRouter();
  const params = useSearchParams();
  const voltarPedido = params.get('voltar');
  const erroUrl = params.get('erro');

  const [etapa, setEtapa] = useState<'senha' | 'codigo' | 'instalacao'>('senha');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<ErroTela>(erroUrl ? { mensagem: ERROS[erroUrl] ?? 'Não foi possível entrar. Tente de novo.', esperar: null } : null);
  const [tentativa, setTentativa] = useState(0);
  const [ajuda, setAjuda] = useState(false);
  const [chaveConfigurada, setChaveConfigurada] = useState(false);
  const idEmail = useId();

  // Sem nenhuma conta ainda: oferece criar o primeiro administrador.
  useEffect(() => {
    if (!loginLigado || erroUrl === 'config') return;
    let vivo = true;
    fetch('/api/auth/instalacao', { cache: 'no-store' })
      .then((r) => r.json() as Promise<{ precisa?: boolean; chaveConfigurada?: boolean }>)
      .then((j) => {
        if (vivo && j.precisa) {
          setChaveConfigurada(!!j.chaveConfigurada);
          setEtapa('instalacao');
        }
      })
      .catch(() => null);
    return () => {
      vivo = false;
    };
  }, [loginLigado, erroUrl]);

  async function enviarSenha(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, senha }) });
      if (r.ok) {
        setSenha('');
        setEtapa('codigo');
      } else setErro(await lerErro(r));
    } catch {
      setErro(SEM_CONEXAO);
    } finally {
      setOcupado(false);
    }
  }

  async function enviarCodigo(codigo: string) {
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch('/api/auth/codigo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ codigo }) });
      if (r.ok) {
        router.replace(caminhoSeguro(voltarPedido, window.location.origin));
        router.refresh();
        return; // continua "ocupado" até a página trocar
      }
      const e = await lerErro(r);
      setErro(e);
      setTentativa((t) => t + 1);
      if (e.reiniciar) setEtapa('senha');
    } catch {
      setErro(SEM_CONEXAO);
    }
    setOcupado(false);
  }

  if (!loginLigado) {
    return (
      <TelaAcesso>
        <Cabecalho titulo="Entrar">O login está desligado neste computador (sem SESSAO_SEGREDO). O Lastro abre direto.</Cabecalho>
        <Link className={`${BOTAO} lastro-botao-primario`} href="/">Abrir o Lastro</Link>
      </TelaAcesso>
    );
  }

  if (etapa === 'instalacao') return <PrimeiroAcesso chaveConfigurada={chaveConfigurada} />;

  return (
    <TelaAcesso>
      {etapa === 'senha' ? (
        <>
          <Cabecalho titulo="Bem-vindo!">Entre com o seu e-mail da Denver, a senha do Lastro e o código do authenticator.</Cabecalho>
          <ErroAcesso erro={erro} />
          <form className="space-y-4" onSubmit={enviarSenha}>
            <Campo rotulo="E-mail" id={idEmail}>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                <input
                  id={idEmail}
                  className="lastro-campo h-11 w-full pl-9 pr-3"
                  type="email"
                  autoComplete="username"
                  placeholder="voce@denvercontabil.com.br"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  maxLength={200}
                  autoFocus
                  required
                />
              </div>
            </Campo>
            <CampoSenha rotulo="Senha" valor={senha} aoMudar={setSenha} autoComplete="current-password" />
            <button className={`${BOTAO} lastro-botao-primario`} type="submit" disabled={ocupado || !email || !senha}>
              {ocupado ? 'Entrando…' : 'Entrar'}
            </button>
          </form>
          <button type="button" className={`${BOTAO} lastro-botao-fantasma`} onClick={() => setAjuda((a) => !a)} aria-expanded={ajuda}>
            Esqueci a senha / troquei de celular
          </button>
          {ajuda && (
            <Aviso tipo="info">
              Peça a um administrador do Lastro um <strong>novo link de acesso</strong> (Perfil › Usuários). Pelo link você cria uma senha
              nova e configura o authenticator de novo. O link vale 48 horas e funciona uma vez só.
            </Aviso>
          )}
        </>
      ) : (
        <>
          <Cabecalho titulo="Código do authenticator">
            Abra o app de authenticator no celular e digite o código de 6 dígitos de <strong>Lastro Bate PDF</strong>.
          </Cabecalho>
          <ErroAcesso erro={erro} />
          <CampoCodigo key={tentativa} aoEnviar={enviarCodigo} ocupado={ocupado} />
          <button
            type="button"
            className={`${BOTAO} lastro-botao-fantasma`}
            onClick={() => {
              setEtapa('senha');
              setErro(null);
            }}
          >
            <ArrowLeft className="size-4" /> Voltar para a senha
          </button>
        </>
      )}

      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">
        <li>Nunca passe o código do authenticator para ninguém. O Lastro não pede código por telefone nem por e-mail.</li>
        <li>Sem usar o Lastro por 30 dias, ele pede o login de novo.</li>
      </ul>
    </TelaAcesso>
  );
}

/** Primeiro acesso: ainda não há conta. Pede a CHAVE_INSTALACAO e cria o administrador. */
function PrimeiroAcesso({ chaveConfigurada }: { chaveConfigurada: boolean }) {
  const router = useRouter();
  const [chave, setChave] = useState('');
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<ErroTela>(null);
  const ids = { chave: useId(), nome: useId(), email: useId() };

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const r = await fetch('/api/auth/instalacao', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chave, nome, email }) });
      if (r.ok) {
        const { token } = (await r.json()) as { token: string };
        router.replace(`/convite#t=${encodeURIComponent(token)}`);
        return;
      }
      setErro(await lerErro(r));
    } catch {
      setErro(SEM_CONEXAO);
    }
    setOcupado(false);
  }

  return (
    <TelaAcesso>
      <Cabecalho titulo="Configuração inicial">O Lastro ainda não tem nenhuma conta. Crie a do primeiro administrador; ele convida as outras pessoas depois.</Cabecalho>
      {!chaveConfigurada ? (
        <Aviso tipo="alerta">
          Falta a variável <code>CHAVE_INSTALACAO</code> no servidor (mínimo de 16 caracteres). Cadastre na Vercel (ou no <code>.env.local</code>),
          publique de novo e volte aqui.
        </Aviso>
      ) : (
        <>
          <ErroAcesso erro={erro} />
          <form className="space-y-4" onSubmit={enviar}>
            <Campo rotulo="Chave de instalação" id={ids.chave} dica="O valor da variável CHAVE_INSTALACAO, cadastrada por quem configurou o app.">
              <input id={ids.chave} className="lastro-campo h-11 w-full px-3" type="password" autoComplete="off" value={chave} onChange={(e) => setChave(e.target.value)} required />
            </Campo>
            <Campo rotulo="Seu nome" id={ids.nome}>
              <input id={ids.nome} className="lastro-campo h-11 w-full px-3" autoComplete="name" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} required />
            </Campo>
            <Campo rotulo="Seu e-mail da Denver" id={ids.email}>
              <input id={ids.email} className="lastro-campo h-11 w-full px-3" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} required />
            </Campo>
            <button className={`${BOTAO} lastro-botao-primario`} type="submit" disabled={ocupado || !chave || !nome || !email}>
              {ocupado ? 'Criando…' : 'Continuar: criar senha e authenticator'}
            </button>
          </form>
        </>
      )}
    </TelaAcesso>
  );
}
