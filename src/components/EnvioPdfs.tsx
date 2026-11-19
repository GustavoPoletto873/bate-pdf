'use client';

import { useRef, useState, type DragEvent } from 'react';
import { FileUp, FolderUp } from 'lucide-react';
import { api, ErroApi } from '@/lib/cliente';
import { Aviso, Botao, cx } from '@/components/ui';

type ArquivoComCaminho = { arquivo: File; caminho: string };

const MAX_POR_LOTE = 25;
const MAX_BYTES_LOTE = 60 * 1024 * 1024;

/** Lê pastas arrastadas (webkitGetAsEntry), recursivo. */
async function lerEntrada(entrada: FileSystemEntry, prefixo = ''): Promise<ArquivoComCaminho[]> {
  if (entrada.isFile) {
    const arquivo = await new Promise<File>((ok, falha) => (entrada as FileSystemFileEntry).file(ok, falha));
    return [{ arquivo, caminho: prefixo + arquivo.name }];
  }
  const leitor = (entrada as FileSystemDirectoryEntry).createReader();
  const filhos: FileSystemEntry[] = [];
  for (;;) {
    const lote = await new Promise<FileSystemEntry[]>((ok, falha) => leitor.readEntries(ok, falha));
    if (!lote.length) break;
    filhos.push(...lote);
  }
  const listas = await Promise.all(filhos.map((f) => lerEntrada(f, `${prefixo}${entrada.name}/`)));
  return listas.flat();
}

export function EnvioPdfs({ baseId, onEnviado, compacto }: { baseId: string; onEnviado?: () => void; compacto?: boolean }) {
  const arquivosRef = useRef<HTMLInputElement>(null);
  const pastaRef = useRef<HTMLInputElement>(null);
  const [progresso, setProgresso] = useState<{ enviados: number; total: number } | null>(null);
  const [resultado, setResultado] = useState<{ novos: number; repetidos: number; recusados: { nome: string; motivo: string }[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  async function enviar(lista: ArquivoComCaminho[]) {
    const pdfs = lista.filter((a) => /\.pdf$/i.test(a.arquivo.name));
    if (!pdfs.length) {
      setErro('Nenhum arquivo .pdf na seleção.');
      return;
    }
    setErro(null);
    setResultado(null);
    setProgresso({ enviados: 0, total: pdfs.length });
    const total = { novos: 0, repetidos: 0, recusados: [] as { nome: string; motivo: string }[] };
    let lote: ArquivoComCaminho[] = [];
    let bytes = 0;
    let enviados = 0;
    const despachar = async () => {
      if (!lote.length) return;
      const form = new FormData();
      for (const a of lote) {
        form.append('arquivos', a.arquivo, a.arquivo.name);
        form.append('caminhos', a.caminho);
      }
      const r = await api.enviarPdfs(baseId, form);
      total.novos += r.novos;
      total.repetidos += r.repetidos;
      total.recusados.push(...r.recusados);
      enviados += lote.length;
      setProgresso({ enviados, total: pdfs.length });
      lote = [];
      bytes = 0;
    };
    try {
      for (const a of pdfs) {
        if (lote.length && (lote.length >= MAX_POR_LOTE || bytes + a.arquivo.size > MAX_BYTES_LOTE)) await despachar();
        lote.push(a);
        bytes += a.arquivo.size;
      }
      await despachar();
      setResultado(total);
      onEnviado?.();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao enviar os PDFs.');
    } finally {
      setProgresso(null);
    }
  }

  async function aoSoltar(e: DragEvent) {
    e.preventDefault();
    setArrastando(false);
    const itens = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => Boolean(x));
    if (itens.length) {
      const listas = await Promise.all(itens.map((i) => lerEntrada(i)));
      enviar(listas.flat());
    } else {
      enviar([...e.dataTransfer.files].map((f) => ({ arquivo: f, caminho: f.name })));
    }
  }

  const deInput = (input: HTMLInputElement | null) => {
    const files = [...(input?.files ?? [])];
    if (input) input.value = '';
    enviar(files.map((f) => ({ arquivo: f, caminho: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name })));
  };

  return (
    <div className="space-y-2">
      <div
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={aoSoltar}
        className={cx(
          'rounded-lg border-2 border-dashed text-center transition-colors',
          compacto ? 'p-3' : 'p-6',
          arrastando ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-300 dark:border-slate-700',
        )}
      >
        {!compacto && <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">Arraste aqui os PDFs ou a pasta inteira da base (termos, CCBs, contratos…)</p>}
        <div className="flex flex-wrap justify-center gap-2">
          <Botao onClick={() => pastaRef.current?.click()} disabled={!!progresso} tamanho={compacto ? 'sm' : 'md'}>
            <FolderUp className="size-4" /> Escolher pasta
          </Botao>
          <Botao onClick={() => arquivosRef.current?.click()} disabled={!!progresso} tamanho={compacto ? 'sm' : 'md'}>
            <FileUp className="size-4" /> Escolher PDFs
          </Botao>
        </div>
        <input ref={arquivosRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => deInput(e.currentTarget)} />
        <input ref={pastaRef} type="file" multiple hidden onChange={(e) => deInput(e.currentTarget)} {...{ webkitdirectory: '', directory: '' }} />
      </div>
      {progresso && (
        <div className="text-sm">
          Enviando {progresso.enviados}/{progresso.total}…
          <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
            <div className="h-full bg-indigo-600 transition-all" style={{ width: `${(100 * progresso.enviados) / progresso.total}%` }} />
          </div>
        </div>
      )}
      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {resultado && (
        <Aviso tipo={resultado.recusados.length ? 'alerta' : 'ok'}>
          {resultado.novos} PDF(s) novo(s){resultado.repetidos ? `, ${resultado.repetidos} já estavam na base` : ''}. A indexação do texto roda em segundo plano.
          {resultado.recusados.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {resultado.recusados.slice(0, 5).map((r) => <li key={r.nome}>{r.nome}: {r.motivo}</li>)}
              {resultado.recusados.length > 5 && <li>… e mais {resultado.recusados.length - 5}</li>}
            </ul>
          )}
        </Aviso>
      )}
    </div>
  );
}
