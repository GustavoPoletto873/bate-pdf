'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { CircleCheck, Circle, Eye, EyeOff, KeyRound } from 'lucide-react';
import { LogoLastro } from '@/components/LogoLastro';
import { Aviso, cx } from '@/components/ui';
import { avaliarSenha, ROTULOS_SENHA, type AvaliacaoSenha } from '@/lib/auth/regrasSenha';

// Peças das telas de acesso (entrar, convite), no mesmo fluxo do Bate Lastro e do dashboard-lastro.

/** Tela cheia por cima do menu, com o cartão no meio. */
export function TelaAcesso({ children, largo }: { children: ReactNode; largo?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 overflow-auto bg-white dark:bg-slate-950">
      <div className="flex min-h-full items-center justify-center p-4">
        <div className={cx('lastro-cartao w-full space-y-5 p-8', largo ? 'max-w-lg' : 'max-w-md')}>{children}</div>
      </div>
    </div>
  );
}

export function Cabecalho({ titulo, children }: { titulo: string; children?: ReactNode }) {
  return (
    <div className="space-y-3 text-center">
      <div className="flex flex-col items-center gap-1">
        <LogoLastro tamanho={44} />
        <span className="text-sm font-extrabold tracking-tight">Lastro</span>
      </div>
      <h1 className="font-display text-2xl tracking-tight">{titulo}</h1>
      {children && <p className="font-serif text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">{children}</p>}
    </div>
  );
}

export function Campo({ rotulo, dica, children, id }: { rotulo: string; dica?: ReactNode; children: ReactNode; id: string }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="lastro-rotulo block text-slate-600 dark:text-slate-400">{rotulo}</label>
      {children}
      {dica && <p className="text-xs text-slate-500 dark:text-slate-400">{dica}</p>}
    </div>
  );
}

/** Campo de senha com botão de mostrar/esconder. */
export function CampoSenha({ rotulo, valor, aoMudar, autoComplete, autoFocus, descritoPor }: {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  autoComplete: 'current-password' | 'new-password';
  autoFocus?: boolean;
  descritoPor?: string;
}) {
  const id = useId();
  const [visivel, setVisivel] = useState(false);
  return (
    <Campo rotulo={rotulo} id={id}>
      <div className="relative">
        <KeyRound className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          id={id}
          className="lastro-campo h-11 w-full pl-9 pr-11"
          type={visivel ? 'text' : 'password'}
          value={valor}
          onChange={(e) => aoMudar(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          aria-describedby={descritoPor}
          maxLength={128}
          required
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100"
          onClick={() => setVisivel((v) => !v)}
          aria-label={visivel ? 'Esconder a senha' : 'Mostrar a senha'}
          aria-pressed={visivel}
        >
          {visivel ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
        </button>
      </div>
    </Campo>
  );
}

/** Lista dos requisitos da senha, marcando o que já foi cumprido (a mesma regra do servidor). */
export function RegrasSenha({ senha, id }: { senha: string; id?: string }) {
  const a = avaliarSenha(senha);
  return (
    <ul className="grid gap-1 text-xs sm:grid-cols-2" id={id} aria-label="Requisitos da senha">
      {(Object.keys(ROTULOS_SENHA) as (keyof AvaliacaoSenha)[]).map((k) => (
        <li key={k} className={cx('flex items-center gap-1.5', a[k] ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400')}>
          {a[k] ? <CircleCheck className="size-3.5 shrink-0" /> : <Circle className="size-3.5 shrink-0" />}
          {ROTULOS_SENHA[k]}
          <span className="sr-only">{a[k] ? ' (cumprido)' : ' (falta)'}</span>
        </li>
      ))}
    </ul>
  );
}

export function senhaForte(senha: string): boolean {
  return Object.values(avaliarSenha(senha)).every(Boolean);
}

/** Segundos até o authenticator trocar o código (muda a cada 30 s, no relógio). */
function useSegundosDoCodigo() {
  const [s, setS] = useState(30);
  useEffect(() => {
    const tique = () => setS(30 - (Math.floor(Date.now() / 1000) % 30));
    tique();
    const id = window.setInterval(tique, 1000);
    return () => window.clearInterval(id);
  }, []);
  return s;
}

/** Campo do código de 6 dígitos do authenticator. Envia sozinho ao completar os 6 dígitos. */
export function CampoCodigo({ aoEnviar, ocupado, rotulo = 'Código do authenticator' }: {
  aoEnviar: (codigo: string) => void;
  ocupado: boolean;
  rotulo?: string;
}) {
  const id = useId();
  const [codigo, setCodigo] = useState('');
  const segundos = useSegundosDoCodigo();
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (codigo.length === 6 && !ocupado) aoEnviar(codigo);
      }}
    >
      <Campo rotulo={rotulo} id={id} dica={<span id={`${id}-dica`}>O código muda em {segundos}s. Se ele trocar enquanto você digita, use o novo.</span>}>
        <input
          id={id}
          className="lastro-campo h-14 w-full text-center font-mono text-2xl tracking-[0.5em]"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          placeholder="000000"
          value={codigo}
          autoFocus
          disabled={ocupado}
          aria-describedby={`${id}-dica`}
          onChange={(e) => {
            const v = e.target.value.replace(/\D/g, '').slice(0, 6);
            setCodigo(v);
            if (v.length === 6 && !ocupado) aoEnviar(v);
          }}
        />
      </Campo>
      <button className="lastro-botao lastro-botao-md lastro-botao-primario w-full justify-center" type="submit" disabled={codigo.length !== 6 || ocupado}>
        {ocupado ? 'Conferindo…' : 'Confirmar código'}
      </button>
    </form>
  );
}

export type ErroTela = { mensagem: string; esperar: number | null; reiniciar?: boolean } | null;

/** Mensagem de erro da tela de acesso (com contagem quando é excesso de tentativas). */
export function ErroAcesso({ erro }: { erro: ErroTela }) {
  const esperar = erro?.esperar ?? null;
  const [resto, setResto] = useState(esperar ?? 0);
  const [deEsperar, setDeEsperar] = useState(esperar);
  if (deEsperar !== esperar) {
    setDeEsperar(esperar);
    setResto(esperar ?? 0);
  }
  useEffect(() => {
    if (!esperar) return;
    const id = window.setInterval(() => setResto((r) => (r > 0 ? r - 1 : 0)), 1000);
    return () => window.clearInterval(id);
  }, [esperar]);
  if (!erro) return null;
  return (
    <div role="alert">
      <Aviso tipo="erro">
        {erro.mensagem}
        {esperar && resto > 0 ? ` (${resto}s)` : ''}
      </Aviso>
    </div>
  );
}

/** Lê a resposta de erro das rotas de acesso. */
export async function lerErro(r: Response): Promise<{ mensagem: string; esperar: number | null; reiniciar: boolean }> {
  const j = (await r.json().catch(() => ({}))) as { erro?: string; esperar?: number; reiniciar?: boolean };
  return {
    mensagem: j.erro ?? (r.status >= 500 ? 'O Lastro não respondeu. Tente de novo em instantes.' : 'Não deu certo. Tente de novo.'),
    esperar: r.status === 429 ? Number(r.headers.get('Retry-After')) || j.esperar || 60 : null,
    reiniciar: !!j.reiniciar,
  };
}

export const SEM_CONEXAO = { mensagem: 'Sem conexão com o Lastro. Confira a internet e tente de novo.', esperar: null };
