'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { Fundo } from '@/lib/fundos';
import type { AlertaBlackList } from '@/lib/blacklist';
import type { UploadsRecentes } from '@/lib/upload-base/registrar';
import { formatarCpfCnpj } from '@/lib/texto';
import { formatarMoeda } from '@/lib/valores';
import { rotuloReferencia, type ModoReferencia } from '@/lib/upload-base/datas';
import { Botao, Dialogo, cx } from '@/components/ui';

/** Indicador das 3 etapas (Dados → Mapeamento → Concluído). */
export function Etapas({ atual }: { atual: 1 | 2 | 3 }) {
  const etapas = ['Dados', 'Mapeamento', 'Concluído'];
  return (
    <ol className="mb-8 flex flex-wrap items-center gap-3" aria-label="Etapas">
      {etapas.map((nome, i) => {
        const n = i + 1;
        const ativa = n === atual;
        const feita = n < atual;
        return (
          <li key={nome} className="flex items-center gap-3">
            {i > 0 && <span aria-hidden="true" className="h-0.5 w-8 bg-slate-300 dark:bg-slate-700" />}
            <span className={cx('flex items-center gap-2 text-sm font-semibold', ativa ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400 dark:text-slate-500')} aria-current={ativa ? 'step' : undefined}>
              <span className={cx('grid size-7 -rotate-6 place-items-center rounded-full border-2 font-display text-xs',
                ativa ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                  : feita ? 'border-slate-900 bg-white text-slate-900 dark:border-slate-200 dark:bg-slate-900 dark:text-slate-100'
                    : 'border-slate-300 bg-white dark:border-slate-700 dark:bg-slate-900')}>
                {n}
              </span>
              {nome}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Escolha do fundo (com o link para o cadastro quando não há nenhum). */
export function EscolhaFundo({ fundos, carregando, valor, onChange, opcional, id = 'upload-fundo' }: {
  fundos: Fundo[] | null; carregando: boolean; valor: string; onChange: (v: string) => void; opcional?: boolean; id?: string;
}) {
  if (fundos && !fundos.length) {
    return (
      <div className="mt-1 rounded-xl border-2 border-dashed border-slate-300 px-4 py-3 text-sm dark:border-slate-700">
        Nenhum fundo cadastrado ainda. <Link href="/cadastro-fundo" className="font-semibold underline decoration-wavy decoration-indigo-500 underline-offset-4">Cadastre o fundo em Gestão › Fundos</Link> e volte aqui.
      </div>
    );
  }
  return (
    <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} disabled={carregando} className="lastro-campo mt-1 h-10 w-full px-3 text-sm">
      <option value="">{carregando ? 'Carregando fundos…' : opcional ? 'Pelo CNPJ da planilha' : 'Selecione um fundo…'}</option>
      {fundos?.map((f) => <option key={f.id} value={f.id}>{f.nome} · {formatarCpfCnpj(f.cnpj)}</option>)}
    </select>
  );
}

export type Referencia = { porTrimestre: boolean; data: string; trimestre: string; ano: string };

/** Data de referência: data exata ou trimestre + ano ("Selecionar por trimestre"). */
export function CampoReferencia({ valor, onChange, obrigatoria = true }: { valor: Referencia; onChange: (r: Referencia) => void; obrigatoria?: boolean }) {
  const anoAtual = new Date().getFullYear();
  return (
    <div>
      <span className="lastro-rotulo">Data de referência{obrigatoria ? '' : ' (opcional)'}</span>
      {valor.porTrimestre ? (
        <div className="mt-1 flex gap-2">
          <select aria-label="Trimestre" value={valor.trimestre} onChange={(e) => onChange({ ...valor, trimestre: e.target.value })} className="lastro-campo h-10 flex-1 px-3 text-sm">
            <option value="">Trimestre</option>
            <option value="1">1º Trimestre (Mar)</option>
            <option value="2">2º Trimestre (Jun)</option>
            <option value="3">3º Trimestre (Set)</option>
            <option value="4">4º Trimestre (Dez)</option>
          </select>
          <input
            aria-label="Ano" type="number" min={anoAtual - 10} max={anoAtual + 1} value={valor.ano}
            onChange={(e) => onChange({ ...valor, ano: e.target.value })} className="lastro-campo h-10 w-28 px-3 text-sm"
          />
        </div>
      ) : (
        <input aria-label="Data de referência" type="date" value={valor.data} onChange={(e) => onChange({ ...valor, data: e.target.value })} className="lastro-campo mt-1 h-10 w-full px-3 text-sm dark:[color-scheme:dark]" />
      )}
      <label className="mt-2 flex cursor-pointer select-none items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <input type="checkbox" className="size-4 accent-slate-900 dark:accent-slate-100" checked={valor.porTrimestre} onChange={(e) => onChange({ ...valor, porTrimestre: e.target.checked })} />
        Selecionar por trimestre <span className="text-slate-400 dark:text-slate-500">(grava o último dia do trimestre)</span>
      </label>
    </div>
  );
}

/** Modal "Upload Recente Detectado". */
export function AvisoUploadRecente({ info, fundo, data, modo, onCancelar, onContinuar }: {
  info: UploadsRecentes | null; fundo: string; data: string; modo: ModoReferencia; onCancelar: () => void; onContinuar: () => void;
}) {
  const ha = (min: number | null) => {
    if (min === null) return '';
    return min < 60 ? `${min} minuto${min === 1 ? '' : 's'}` : `${Math.floor(min / 60)} h ${min % 60} min`;
  };
  return (
    <Dialogo
      aberto={!!info}
      titulo="Upload Recente Detectado"
      onFechar={onCancelar}
      rodape={<>
        <Botao variante="fantasma" onClick={onCancelar}>Cancelar</Botao>
        <Botao variante="primario" onClick={onContinuar}>Continuar Assim Mesmo</Botao>
      </>}
    >
      {info && (
        <div className="space-y-3 text-sm">
          <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400"><AlertTriangle className="size-5" /> <b>Este fundo já recebeu uma base para essa data há pouco.</b></div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-xl border-2 border-dashed border-amber-300 p-3 dark:border-amber-500/40">
            <dt className="text-slate-500 dark:text-slate-400">Fundo</dt><dd className="truncate">{fundo}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Data ref.</dt><dd>{rotuloReferencia(data, modo)}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Último upload</dt><dd>há {ha(info.minutos_desde_ultimo)}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Bases nos últimos {info.minutos_intervalo} min</dt><dd className="font-semibold">{info.quantidade_uploads}</dd>
          </dl>
          <p className="font-serif text-slate-600 dark:text-slate-400">Deseja continuar mesmo assim? Enviar de novo cria outra base com os mesmos títulos.</p>
        </div>
      )}
    </Dialogo>
  );
}

/** Aviso da BlackList logo depois de criar a base (AlertaBlackListModal). */
export function AlertaBlackListBase({ alertas, onFechar }: { alertas: AlertaBlackList[]; onFechar: () => void }) {
  return (
    <Dialogo
      aberto={alertas.length > 0}
      titulo="Atenção: BlackList"
      onFechar={onFechar}
      largura="max-w-2xl"
      rodape={<>
        <Link href="/blacklist" className="lastro-botao lastro-botao-md lastro-botao-secundario">Ver a BlackList</Link>
        <Botao variante="primario" onClick={onFechar}>Entendi</Botao>
      </>}
    >
      <p className="font-serif text-sm text-slate-600 dark:text-slate-400">
        A base foi criada, mas tem cedentes ou sacados monitorados na BlackList. Nada foi bloqueado: confira com atenção os títulos deles.
      </p>
      <table className="mt-3 w-full text-sm">
        <thead><tr className="border-b-2 border-slate-900 text-left dark:border-slate-200">
          {['Nome', 'Documento', 'Papel', 'Linhas', 'Valor nominal'].map((t) => <th key={t} className="lastro-rotulo px-2 py-1.5">{t}</th>)}
        </tr></thead>
        <tbody>
          {alertas.map((a) => (
            <tr key={`${a.entrada_id}-${a.papel}`} className="border-b border-dashed border-slate-200 dark:border-slate-800">
              <td className="px-2 py-1.5 font-medium">{a.nome}</td>
              <td className="px-2 py-1.5 font-mono text-xs">{formatarCpfCnpj(a.documento)}</td>
              <td className="px-2 py-1.5 capitalize">{a.papel}</td>
              <td className="px-2 py-1.5 tabular-nums">{a.linhas}</td>
              <td className="px-2 py-1.5 tabular-nums">{formatarMoeda(a.valor_nominal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialogo>
  );
}
