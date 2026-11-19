'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { Aviso, cx, Dialogo } from '@/components/ui';
import { VisualizadorPdf } from '@/components/pdf/VisualizadorPdf';
import { exibirValor } from '@/lib/exibir';
import type { CampoId } from '@/lib/campos';

export type Mensagem = { tipo: 'ok' | 'erro' | 'alerta' | 'info'; texto: string } | null;

/** Aviso fechável no topo da tela. */
export function BarraMensagem({ mensagem, onFechar }: { mensagem: Mensagem; onFechar: () => void }) {
  if (!mensagem) return null;
  return (
    <div className="relative mb-4">
      <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>
      <button type="button" className="absolute right-2 top-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-100" onClick={onFechar} aria-label="Fechar aviso">×</button>
    </div>
  );
}

/** Link com cara de botão pílula (para navegar sem aninhar <button> em <a>). */
export function LinkBotao({ href, children, variante = 'secundario', tamanho = 'md', title, download }: {
  href: string; children: ReactNode; variante?: 'primario' | 'secundario' | 'fantasma'; tamanho?: 'sm' | 'md'; title?: string; download?: boolean;
}) {
  const classe = cx('lastro-botao', tamanho === 'sm' ? 'lastro-botao-sm' : 'lastro-botao-md', `lastro-botao-${variante}`);
  if (download) return <a href={href} download className={classe} title={title}>{children}</a>;
  return <Link href={href} className={classe} title={title}>{children}</Link>;
}

/** Visualizador do PDF de uma leitura, num diálogo grande. */
export function DialogoPdf({ pdf, onFechar }: { pdf: { id: number; nome: string; pagina?: number | null } | null; onFechar: () => void }) {
  return (
    <Dialogo aberto={Boolean(pdf)} titulo={pdf?.nome ?? 'Documento'} onFechar={onFechar} largura="max-w-5xl">
      {pdf && (
        <div className="flex h-[72vh] flex-col">
          <a className="mb-2 inline-flex w-fit items-center gap-1 text-xs text-slate-500 underline decoration-dotted hover:text-indigo-600 dark:text-slate-400 dark:hover:text-indigo-400" href={`/api/pdfs/${pdf.id}/arquivo`} target="_blank" rel="noreferrer">
            <ExternalLink className="size-3" /> abrir em nova aba
          </a>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
            <VisualizadorPdf key={pdf.id} pdfId={pdf.id} paginaAlvo={pdf.pagina ?? 1} />
          </div>
        </div>
      )}
    </Dialogo>
  );
}

/** Valor de um campo para a tela, com "—" no vazio. */
export function valorTela(campo: CampoId, valor: string | null | undefined): string {
  return exibirValor(campo, valor ?? null) || '—';
}

/** Par base/leitura numa célula de tabela (base em cima, leitura embaixo). */
export function ParBaseLeitura({ campo, base, leitura, confere }: { campo: CampoId; base: string | null | undefined; leitura: string | null | undefined; confere?: boolean }) {
  return (
    <div className="min-w-0 leading-tight">
      <div className="truncate text-slate-800 dark:text-slate-100" title={base ?? ''}>{valorTela(campo, base)}</div>
      <div className={cx('truncate text-[11px]', confere === false ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400')} title={leitura ?? ''}>
        {valorTela(campo, leitura)}
      </div>
    </div>
  );
}
