'use client';

import { useState } from 'react';
import { FileSpreadsheet, Info, Loader2, Upload } from 'lucide-react';
import { apiBates } from '@/lib/cliente/bates';
import { ErroApi } from '@/lib/cliente';
import type { ResumoInsercao } from '@/lib/bates/inserirResultado';
import { Aviso, Botao, cx, Dialogo } from '@/components/ui';

const ROTULOS_CASO: Record<string, string> = {
  bate_criado: 'Bate novo (sem PDF, dados da planilha)',
  pre_bate_confirmado: 'Pré-bate confirmado',
  marcacoes_atualizadas: 'Já batido, vereditos por campo atualizados',
  ja_batido_igual: 'Já batido, sem alteração',
};
const LADOS = [['termo', 'Termo'], ['lastro', 'Lastro']] as const;

function Previa({ resumo }: { resumo: ResumoInsercao }) {
  const pendentes = resumo.por_aba.TERMO.pendentes + resumo.por_aba.LASTRO.pendentes;
  return (
    <div className="space-y-3 text-sm">
      <p className="font-display">{resumo.simulado ? 'Prévia da planilha. Nada foi gravado ainda.' : 'Resultado inserido.'}</p>
      <table className="w-full text-left">
        <thead className="lastro-rotulo text-slate-500 dark:text-slate-400">
          <tr><th className="pb-1">Situação</th>{LADOS.map(([k, r]) => <th key={k} className="pb-1 text-right">{r}</th>)}</tr>
        </thead>
        <tbody>
          {Object.entries(ROTULOS_CASO).map(([caso, rotulo]) => (
            <tr key={caso} className="border-t border-slate-100 dark:border-slate-800">
              <td className="py-1.5">{rotulo}</td>
              {LADOS.map(([k]) => <td key={k} className="py-1.5 text-right tabular-nums">{resumo.casos[k][caso as keyof ResumoInsercao['casos']['termo']] ?? 0}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className="space-y-1 text-xs text-slate-500 dark:text-slate-400">
        <li>{pendentes} linha(s) com STATUS diferente de V: ficam como estão.</li>
        {resumo.localizados_por_numero > 0 && <li>{resumo.localizados_por_numero} título(s) achado(s) pelo nº do documento + valor (sem ID_BASE desta base).</li>}
      </ul>
      {resumo.nao_encontrados.length > 0 && (
        <details open={resumo.nao_encontrados.length <= 5}>
          <summary className="cursor-pointer font-medium text-amber-700 dark:text-amber-300">Não encontrados nesta base ({resumo.nao_encontrados.length}): serão ignorados</summary>
          <ul className="mt-1 max-h-48 list-disc space-y-0.5 overflow-y-auto pl-5 text-xs text-slate-600 dark:text-slate-300">
            {resumo.nao_encontrados.map((n) => (
              <li key={`${n.aba}-${n.linha}`}>{n.aba}, linha {n.linha} · ID {n.id_base ?? '—'} · nº {n.numero_documento || '—'}: {n.motivo}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Inserir Resultado: sobe um resultados_matching revisado, confere (prévia) e grava. */
export function DialogoInserirResultado({ baseId, aberto, onFechar, onInserido }: { baseId: string; aberto: boolean; onFechar: () => void; onInserido: (r: ResumoInsercao) => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resumo, setResumo] = useState<ResumoInsercao | null>(null);

  const escolher = (novo: File | undefined) => {
    if (!novo || carregando) return;
    if (!/\.xlsx$/i.test(novo.name)) { setErro('Envie o .xlsx exportado em Resultados.'); return; }
    setArquivo(novo);
    setResumo(null);
    setErro(null);
  };
  const enviar = async (simular: boolean) => {
    if (!arquivo) return;
    setCarregando(true);
    setErro(null);
    try {
      const r = await apiBates.inserirResultado(baseId, arquivo, simular);
      setResumo(r);
      if (!simular) onInserido(r);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível ler a planilha. Confira se é o arquivo exportado em Resultados.');
    } finally {
      setCarregando(false);
    }
  };
  const fechar = () => {
    if (carregando) return;
    setArquivo(null);
    setResumo(null);
    setErro(null);
    onFechar();
  };
  const gravado = resumo && !resumo.simulado;

  return (
    <Dialogo
      aberto={aberto}
      titulo="Inserir Resultado Matching"
      onFechar={fechar}
      largura="max-w-xl"
      rodape={
        <>
          <Botao variante="fantasma" onClick={fechar} disabled={carregando}>{gravado ? 'Fechar' : 'Cancelar'}</Botao>
          {!gravado && (resumo?.simulado ? (
            <Botao variante="primario" onClick={() => enviar(false)} disabled={carregando || resumo.total_a_gravar === 0}>
              {carregando && <Loader2 className="size-4 animate-spin" />}
              {resumo.total_a_gravar ? `Confirmar ${resumo.total_a_gravar} título(s)` : 'Nada a alterar'}
            </Botao>
          ) : (
            <Botao variante="primario" onClick={() => enviar(true)} disabled={carregando || !arquivo}>
              {carregando && <Loader2 className="size-4 animate-spin" />} Conferir planilha
            </Botao>
          ))}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-200">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          <span>Títulos com STATUS V na planilha ficam batidos, com os vereditos DIV_* da planilha. Os demais não mudam: a planilha nunca desfaz um bate.</span>
        </div>
        {!gravado && (
          <label
            onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
            onDragLeave={() => setArrastando(false)}
            onDrop={(e) => { e.preventDefault(); setArrastando(false); escolher(e.dataTransfer.files?.[0]); }}
            className={cx('flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center text-sm transition-colors',
              arrastando ? 'border-slate-500 bg-slate-50 dark:border-slate-400 dark:bg-slate-800/50' : 'border-slate-300 hover:border-slate-500 dark:border-slate-700 dark:hover:border-slate-500')}
          >
            <input type="file" accept=".xlsx" className="hidden" disabled={carregando} onChange={(e) => { escolher(e.target.files?.[0]); e.target.value = ''; }} />
            {arquivo ? (
              <span className="flex items-center gap-2 font-medium"><FileSpreadsheet className="size-4 text-slate-500 dark:text-slate-400" />{arquivo.name}</span>
            ) : (
              <>
                <Upload className="size-5 text-slate-400" />
                <span className="text-slate-600 dark:text-slate-300">Arraste o resultados_matching_….xlsx ou clique para escolher</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">Não renomeie o arquivo: o CNPJ do fundo vai no nome.</span>
              </>
            )}
          </label>
        )}
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {resumo && <Previa resumo={resumo} />}
      </div>
    </Dialogo>
  );
}
