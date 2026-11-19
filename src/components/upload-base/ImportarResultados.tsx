'use client';

import { useRef, useState } from 'react';
import { FileSpreadsheet } from 'lucide-react';
import type { Fundo } from '@/lib/fundos';
import type { BaseRegistrada, PreviaResultados } from '@/lib/upload-base/registrar';
import { apiUploadBase } from '@/lib/cliente/uploadBase';
import { formatarCpfCnpj } from '@/lib/texto';
import { fimDoTrimestre } from '@/lib/upload-base/datas';
import { Aviso, Botao, Etiqueta } from '@/components/ui';
import { mensagemDeErro } from '@/components/fundos/util';
import { CampoReferencia, EscolhaFundo, type Referencia } from './partes';

/**
 * Contingência: a base sai do resultados_matching_*.xlsx exportado em Resultados do Bate Lastro.
 * Os títulos guardam o ID_BASE (a volta pelo Inserir Resultado acha o título direto) e o lado com
 * STATUS V entra como já batido.
 */
export function ImportarResultados({ fundos, carregandoFundos, onConcluido }: {
  fundos: Fundo[] | null; carregandoFundos: boolean; onConcluido: (b: BaseRegistrada) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<PreviaResultados | null>(null);
  const [fundoId, setFundoId] = useState('');
  const [ref, setRef] = useState<Referencia>({ porTrimestre: false, data: '', trimestre: '', ano: String(new Date().getFullYear()) });
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  async function ler(f: File) {
    setArquivo(f);
    setPrevia(null);
    setErro(null);
    if (!/\.xlsx$/i.test(f.name)) { setErro('Envie o resultados_matching_*.xlsx exportado em Resultados do Bate Lastro (arquivo .xlsx).'); return; }
    setOcupado(true);
    try {
      const p = await apiUploadBase.previaResultados(f);
      setPrevia(p);
      setFundoId(p.fundo_sugerido ? String(p.fundo_sugerido.id) : '');
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível ler a planilha. Confira se é o resultados_matching exportado do Bate Lastro.'));
    } finally {
      setOcupado(false);
    }
  }

  const data = ref.porTrimestre ? (ref.trimestre && Number(ref.ano) ? fimDoTrimestre(Number(ref.trimestre), Number(ref.ano)) : '') : ref.data;
  const fundo = fundos?.find((x) => String(x.id) === fundoId) ?? null;
  const cnpjDiferente = fundo && previa?.cnpj_fundo && fundo.cnpj !== previa.cnpj_fundo;

  async function criar() {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    try {
      onConcluido(await apiUploadBase.criarDeResultados(arquivo, {
        fundo_id: fundoId ? Number(fundoId) : null, data_referencia: data, modo: ref.porTrimestre ? 'TRIMESTRE' : 'DATA_REFERENCIA',
      }));
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível criar a base. Tente de novo.'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="font-serif text-[15px] leading-relaxed text-slate-600 dark:text-slate-400">
        Para quando o Bate Lastro saiu do ar no meio de uma auditoria: o <code className="font-mono text-[13px]">resultados_matching_*.xlsx</code> exportado em
        Resultados traz o ID de cada título e o que já está batido (o lado com STATUS V entra como já batido). No fim, o resultado volta pelo
        <b className="font-sans font-semibold text-slate-900 dark:text-slate-100"> Inserir Resultado</b>, que acha cada título direto pelo ID.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Botao onClick={() => inputRef.current?.click()} disabled={ocupado}><FileSpreadsheet className="size-4" /> {arquivo ? 'Trocar planilha' : 'Escolher planilha'}</Botao>
        {arquivo && <span className="truncate text-sm text-slate-600 dark:text-slate-400">{arquivo.name}</span>}
        <input ref={inputRef} type="file" hidden accept=".xlsx" onChange={(e) => { const f = e.currentTarget.files?.[0]; e.currentTarget.value = ''; if (f) ler(f); }} />
      </div>
      {ocupado && !previa && <p className="text-sm text-slate-500 dark:text-slate-400">Lendo a planilha…</p>}
      {previa && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Etiqueta cor="indigo">Resultados do Bate Lastro</Etiqueta>
            <Etiqueta>{previa.titulos} títulos</Etiqueta>
            <Etiqueta cor="amber">pendentes: Termo {previa.pendentes.termo} · Lastro {previa.pendentes.lastro}</Etiqueta>
            {previa.ja_batidos > 0 && <Etiqueta cor="emerald">{previa.ja_batidos} lados já batidos</Etiqueta>}
            {previa.cnpj_fundo && <Etiqueta cor="sky">CNPJ {formatarCpfCnpj(previa.cnpj_fundo)}</Etiqueta>}
          </div>
          {previa.avisos.map((a) => <Aviso key={a} tipo="alerta">{a}</Aviso>)}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="text-sm">
              <label htmlFor="resultado-fundo" className="lastro-rotulo">Fundo (opcional)</label>
              <EscolhaFundo id="resultado-fundo" fundos={fundos} carregando={carregandoFundos} valor={fundoId} onChange={setFundoId} opcional />
              {!fundoId && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Sem fundo escolhido, a base fica com o nome e o CNPJ da planilha{previa.nome_fundo ? ` (${previa.nome_fundo})` : ''}.</p>}
            </div>
            <CampoReferencia valor={ref} onChange={setRef} obrigatoria={false} />
          </div>
          {cnpjDiferente && <Aviso tipo="alerta">O CNPJ da planilha ({formatarCpfCnpj(previa.cnpj_fundo)}) é diferente do fundo escolhido ({formatarCpfCnpj(fundo.cnpj)}). Confira se é o arquivo certo.</Aviso>}
          <Botao variante="primario" onClick={criar} disabled={ocupado}>{ocupado ? 'Criando…' : 'Criar base'}</Botao>
        </div>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
    </div>
  );
}
