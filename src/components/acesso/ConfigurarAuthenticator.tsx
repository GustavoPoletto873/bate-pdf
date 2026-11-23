'use client';

import { useState, type ReactNode } from 'react';
import { ArrowLeft, Check, Copy, Smartphone } from 'lucide-react';
import { cx } from '@/components/ui';
import { CampoCodigo } from './Campos';

// Configuração do authenticator em 3 passos, como o MfaSetupModal do Bate Lastro:
// instalar o app → escanear o QR code (ou digitar a chave) → confirmar o código.

export interface DadosAuthenticator {
  segredo: string;
  qr: string; // data URL (PNG)
}

const NOME = 'Lastro Bate PDF';

export function ConfigurarAuthenticator({ dados, aoConfirmar, ocupado, erro, tentativa }: {
  dados: DadosAuthenticator;
  aoConfirmar: (codigo: string) => void;
  ocupado: boolean;
  erro: ReactNode;
  /** Muda a cada erro, para limpar o campo do código. */
  tentativa: number;
}) {
  const [passo, setPasso] = useState(1);
  const [copiado, setCopiado] = useState(false);
  const chaveAgrupada = dados.segredo.match(/.{1,4}/g)?.join(' ') ?? dados.segredo;
  const botao = 'lastro-botao lastro-botao-md w-full justify-center';

  async function copiar() {
    try {
      await navigator.clipboard.writeText(dados.segredo);
      setCopiado(true);
      window.setTimeout(() => setCopiado(false), 2000);
    } catch {
      setCopiado(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-center gap-1.5" aria-label={`Passo ${passo} de 3`}>
        {[1, 2, 3].map((n) => (
          <span key={n} className={cx('h-1.5 w-10 rounded-full', n <= passo ? 'bg-slate-900 dark:bg-slate-200' : 'bg-slate-200 dark:bg-slate-700')} />
        ))}
      </div>

      {passo === 1 && (
        <div className="space-y-4 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full border-2 border-slate-900 dark:border-slate-200" aria-hidden="true">
            <Smartphone className="size-6" />
          </div>
          <h2 className="font-display text-lg">Instale um app de authenticator</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No celular, instale o <strong>Google Authenticator</strong> ou o <strong>Microsoft Authenticator</strong> (App Store ou Play Store).
            Se você já usa um para o Bate Lastro, pode usar o mesmo.
          </p>
          <button type="button" className={cx(botao, 'lastro-botao-primario')} onClick={() => setPasso(2)}>Já tenho o app</button>
        </div>
      )}

      {passo === 2 && (
        <div className="space-y-4 text-center">
          <h2 className="font-display text-lg">Escaneie o QR code</h2>
          <p className="text-sm text-slate-600 dark:text-slate-400">No app, toque em “+” e escolha escanear um QR code.</p>
          {/* eslint-disable-next-line @next/next/no-img-element -- imagem gerada na hora (data URL) */}
          <img className="mx-auto rounded-xl border-2 border-slate-900 bg-white p-2 dark:border-slate-200" src={dados.qr} alt={`QR code para adicionar o ${NOME} no authenticator`} width={232} height={232} />
          <details className="text-left text-sm">
            <summary className="cursor-pointer text-slate-600 dark:text-slate-400">Não consigo escanear: digitar a chave</summary>
            <p className="mt-2 text-slate-600 dark:text-slate-400">No app, escolha “inserir chave de configuração”, dê o nome “{NOME}” e digite:</p>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900">{chaveAgrupada}</code>
              <button type="button" className="lastro-botao lastro-botao-sm lastro-botao-secundario" onClick={copiar}>
                {copiado ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copiado ? 'Copiada' : 'Copiar'}
              </button>
            </div>
          </details>
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className={cx(botao, 'lastro-botao-secundario')} onClick={() => setPasso(1)}>Voltar</button>
            <button type="button" className={cx(botao, 'lastro-botao-primario')} onClick={() => setPasso(3)}>Escaneei</button>
          </div>
        </div>
      )}

      {passo === 3 && (
        <div className="space-y-4">
          <div className="space-y-1 text-center">
            <h2 className="font-display text-lg">Confirme o código</h2>
            <p className="text-sm text-slate-600 dark:text-slate-400">Digite o código de 6 dígitos que aparece no app para “{NOME}”.</p>
          </div>
          {erro}
          <CampoCodigo key={tentativa} aoEnviar={aoConfirmar} ocupado={ocupado} rotulo="Código de 6 dígitos" />
          <button type="button" className={cx(botao, 'lastro-botao-fantasma')} onClick={() => setPasso(2)}>
            <ArrowLeft className="size-4" /> Ver o QR code de novo
          </button>
        </div>
      )}
    </div>
  );
}
