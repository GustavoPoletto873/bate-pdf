'use client';

import { useMemo, useRef, useState, type DragEvent } from 'react';
import { ArrowLeft, CheckCircle2, FileUp, FolderOpen, Play, Trash2, TriangleAlert, X } from 'lucide-react';
import { ErroApi } from '@/lib/cliente';
import { apiAnexo, type BaseDoAnexo, type Recusado } from '@/lib/cliente/anexo';
import { extensao, EXTENSOES_ACEITAS, MAX_BYTES_LOTE, MAX_DOCUMENTOS, montarPreview, previaValida, type GrupoPrevia } from '@/lib/anexo/caminhos';
import { Aviso, Botao, cx } from '@/components/ui';
import { Secao } from '@/components/Pagina';
import { IconeRabisco } from '@/components/rabiscos';
import { ProgressoLote } from './ProgressoLote';
import { plural } from './rotulos';

type Arquivo = { id: string; arquivo: File; caminho: string };
type Zip = { carregando: boolean; caminhos: string[]; erro: string | null };

const MAX_POR_LEVA = 25;
const MAX_BYTES_LEVA = 60 * 1024 * 1024;
const ACCEPT = EXTENSOES_ACEITAS.join(',');
const MAX_EXEMPLOS = 5;

let sequencia = 0;
const novoId = () => `a${++sequencia}`;
const caminhoDe = (f: File) => ((f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name).replace(/\\/g, '/');

/** Lê pastas arrastadas (webkitGetAsEntry), recursivo — como o EnvioPdfs. */
async function lerEntrada(entrada: FileSystemEntry, prefixo = ''): Promise<{ arquivo: File; caminho: string }[]> {
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
  return (await Promise.all(filhos.map((f) => lerEntrada(f, `${prefixo}${entrada.name}/`)))).flat();
}

function Alerta({ tom, titulo, itens, children }: { tom: 'erro' | 'alerta'; titulo: string; itens?: string[]; children?: React.ReactNode }) {
  return (
    <Aviso tipo={tom}>
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" />
        <div className="min-w-0">
          <p className="font-semibold">{titulo}</p>
          {itens && itens.length > 0 && (
            <ul className="mt-1 space-y-0.5 font-mono text-xs">
              {itens.slice(0, MAX_EXEMPLOS).map((i) => <li key={i} className="truncate" title={i}>{i}</li>)}
              {itens.length > MAX_EXEMPLOS && <li className="font-sans">e mais {itens.length - MAX_EXEMPLOS}…</li>}
            </ul>
          )}
          {children}
        </div>
      </div>
    </Aviso>
  );
}

function ListaOperacoes({ grupos }: { grupos: GrupoPrevia[] }) {
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<string | null>(null);
  const termo = busca.trim().toLowerCase();
  const filtrados = termo ? grupos.filter((g) => g.pasta.toLowerCase().includes(termo) || g.arquivos.some((a) => a.toLowerCase().includes(termo))) : grupos;
  return (
    <div className="space-y-2">
      {grupos.length > 8 && <input className="lastro-campo h-9 w-full px-3 text-sm" placeholder="Buscar operação ou arquivo" value={busca} onChange={(e) => setBusca(e.target.value)} />}
      <ul className="rolagem-fina max-h-80 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
        {filtrados.slice(0, 300).map((g) => (
          <li key={g.chave}>
            <button type="button" onClick={() => setAberta(aberta === g.chave ? null : g.chave)} className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-900">
              <span className="max-w-[45%] shrink-0 truncate font-mono text-xs" title={g.pasta}>{g.nome}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500 dark:text-slate-400">{aberta !== g.chave && g.arquivos.join(' · ')}</span>
              <span className="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-800 dark:bg-sky-500/20 dark:text-sky-200">{plural(g.arquivos.length, 'doc', 'docs')}</span>
            </button>
            {aberta === g.chave && (
              <div className="px-3 pb-3">
                <p className="mb-1 break-all font-mono text-[11px] text-slate-400">{g.pasta}/</p>
                <div className="flex flex-wrap gap-1">{g.arquivos.map((a) => <span key={a} className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] dark:border-slate-700">{a}</span>)}</div>
              </div>
            )}
          </li>
        ))}
        {!filtrados.length && <li className="px-3 py-4 text-center text-sm text-slate-500 dark:text-slate-400">Nenhuma operação encontrada.</li>}
      </ul>
    </div>
  );
}

export function EtapaUpload({ base, onVoltar }: { base: BaseDoAnexo; onVoltar: () => void }) {
  const pastaRef = useRef<HTMLInputElement>(null);
  const arquivosRef = useRef<HTMLInputElement>(null);
  const [arquivos, setArquivos] = useState<Arquivo[]>([]);
  const [ignorados, setIgnorados] = useState<string[]>([]);
  const [zips, setZips] = useState<Record<string, Zip>>({});
  const [agrupar, setAgrupar] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [envio, setEnvio] = useState<{ enviados: number; total: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [recusados, setRecusados] = useState<Recusado[]>([]);
  const [lotes, setLotes] = useState<string[]>([]);

  function adicionar(lista: { arquivo: File; caminho: string }[]) {
    setErro(null);
    const aceitos: Arquivo[] = [];
    const fora: string[] = [];
    for (const a of lista) {
      if (EXTENSOES_ACEITAS.includes(extensao(a.caminho))) aceitos.push({ id: novoId(), ...a });
      else fora.push(a.caminho);
    }
    setIgnorados((x) => [...x, ...fora]);
    setArquivos((x) => [...x, ...aceitos]);
    // O conteúdo de cada ZIP é listado no servidor (mesmos limites do processamento).
    for (const z of aceitos.filter((a) => extensao(a.caminho) === '.zip')) {
      setZips((x) => ({ ...x, [z.id]: { carregando: true, caminhos: [], erro: null } }));
      apiAnexo.conteudoZip(z.arquivo)
        .then((r) => setZips((x) => ({ ...x, [z.id]: { carregando: false, caminhos: r.caminhos, erro: null } })))
        .catch((e) => setZips((x) => ({ ...x, [z.id]: { carregando: false, caminhos: [], erro: e instanceof ErroApi ? e.message : `Não foi possível ler ${z.caminho}.` } })));
    }
  }

  async function aoSoltar(e: DragEvent) {
    e.preventDefault();
    setArrastando(false);
    const itens = [...e.dataTransfer.items].map((i) => i.webkitGetAsEntry?.()).filter((x): x is FileSystemEntry => Boolean(x));
    if (itens.length) adicionar((await Promise.all(itens.map((i) => lerEntrada(i)))).flat());
    else adicionar([...e.dataTransfer.files].map((f) => ({ arquivo: f, caminho: f.name })));
  }

  const deInput = (input: HTMLInputElement | null) => {
    const files = [...(input?.files ?? [])];
    if (input) input.value = '';
    adicionar(files.map((f) => ({ arquivo: f, caminho: caminhoDe(f) })));
  };

  function limpar() {
    setArquivos([]);
    setZips({});
    setIgnorados([]);
    setRecusados([]);
    setErro(null);
  }

  const lendoZips = Object.values(zips).some((z) => z.carregando);
  const errosZip = Object.values(zips).map((z) => z.erro).filter((x): x is string => !!x);
  const bytes = arquivos.reduce((s, a) => s + a.arquivo.size, 0);
  const previa = useMemo(() => {
    if (!arquivos.length || lendoZips) return null;
    const caminhos: string[] = [];
    for (const a of arquivos) {
      if (extensao(a.caminho) === '.zip') caminhos.push(...(zips[a.id]?.caminhos ?? []));
      else caminhos.push(a.caminho);
    }
    return montarPreview(caminhos, agrupar);
  }, [arquivos, zips, agrupar, lendoZips]);
  const excedeBytes = bytes > MAX_BYTES_LOTE;
  const podeProcessar = previaValida(previa) && !errosZip.length && !excedeBytes && !envio;

  async function processar() {
    if (!podeProcessar) return;
    setErro(null);
    setRecusados([]);
    const lista = [...arquivos];
    setEnvio({ enviados: 0, total: lista.length });
    let loteId: string | null = null;
    const todosRecusados: Recusado[] = [];
    try {
      loteId = (await apiAnexo.criarLote(base.id, agrupar)).id;
      setLotes((x) => [loteId!, ...x]);
      // Levas pequenas (como o EnvioPdfs): um ZIP vai sozinho.
      let leva: Arquivo[] = [];
      let tamanho = 0;
      let enviados = 0;
      const despachar = async () => {
        if (!leva.length) return;
        const form = new FormData();
        for (const a of leva) {
          form.append('arquivos', a.arquivo, a.arquivo.name);
          form.append('caminhos', a.caminho);
        }
        const r = await apiAnexo.enviarArquivos(loteId!, form);
        todosRecusados.push(...r.recusados);
        enviados += leva.length;
        setEnvio({ enviados, total: lista.length });
        leva = [];
        tamanho = 0;
      };
      for (const a of lista) {
        const ehZip = extensao(a.caminho) === '.zip';
        if (leva.length && (ehZip || leva.length >= MAX_POR_LEVA || tamanho + a.arquivo.size > MAX_BYTES_LEVA)) await despachar();
        leva.push(a);
        tamanho += a.arquivo.size;
        if (ehZip) await despachar();
      }
      await despachar();
      setArquivos([]);
      setZips({});
      setIgnorados([]);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Falha ao enviar os documentos. Confira se o app está rodando e tente de novo.');
    } finally {
      setRecusados(todosRecusados);
      setEnvio(null);
    }
  }

  const unicos = previa?.grupos.filter((g) => g.arquivos.length === 1).length ?? 0;

  return (
    <>
      <Secao
        titulo="Upload"
        descricao="Termos de cessão, CCBs, duplicatas, notas… Cada PDF é classificado e lido pelo Gemini; XML de NF-e é lido aqui mesmo."
        acoes={<Botao tamanho="sm" variante="fantasma" onClick={onVoltar}><ArrowLeft className="size-3.5" /> Trocar base</Botao>}
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
          <div>
            <p className="font-semibold">Agrupamento por operação <span className="ml-1 text-xs font-normal text-slate-500 dark:text-slate-400">{agrupar ? 'Por pasta' : 'Desativado · padrão'}</span></p>
            <p className="text-sm text-slate-600 dark:text-slate-400">{agrupar ? 'Os arquivos dentro da mesma pasta formam uma operação.' : 'Cada arquivo é processado de forma independente.'}</p>
          </div>
          <button
            type="button" role="switch" aria-checked={agrupar} aria-label="Agrupar arquivos por pasta" disabled={!!envio}
            onClick={() => setAgrupar((x) => !x)}
            className={cx('relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-slate-900 transition-colors dark:border-slate-200', agrupar ? 'bg-slate-900 dark:bg-slate-200' : 'bg-white dark:bg-slate-900')}
          >
            <span className={cx('inline-block size-4 rounded-full transition-transform', agrupar ? 'translate-x-5 bg-white dark:bg-slate-900' : 'translate-x-0.5 bg-slate-900 dark:bg-slate-200')} />
          </button>
        </div>

        <div
          onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
          onDragLeave={() => setArrastando(false)}
          onDrop={aoSoltar}
          className={cx('rounded-xl border-2 border-dashed p-6 text-center transition-colors', arrastando ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-500/10' : 'border-slate-300 dark:border-slate-700')}
        >
          <div className="mx-auto mb-2 w-fit -rotate-6"><IconeRabisco tipo="clipe" tamanho={36} /></div>
          <p className="mb-3 text-sm text-slate-600 dark:text-slate-400">{arrastando ? 'Solte os arquivos aqui!' : 'Arraste aqui a pasta, os arquivos ou um ZIP (PDF, XML, JPG, PNG)'}</p>
          <div className="flex flex-wrap justify-center gap-2">
            <Botao onClick={() => pastaRef.current?.click()} disabled={!!envio}><FolderOpen className="size-4" /> Selecionar pasta</Botao>
            <Botao onClick={() => arquivosRef.current?.click()} disabled={!!envio}><FileUp className="size-4" /> Selecionar arquivos</Botao>
          </div>
          <input ref={arquivosRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => deInput(e.currentTarget)} />
          <input ref={pastaRef} type="file" multiple hidden onChange={(e) => deInput(e.currentTarget)} {...{ webkitdirectory: '', directory: '' }} />
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">Até {MAX_DOCUMENTOS} documentos e 250 MB por lote.</p>
        </div>

        <div className="mt-4 space-y-2">
          {!arquivos.length && !lotes.length && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {agrupar ? 'Use “Selecionar pasta” e escolha a pasta que contém as operações. A conferência aparece aqui.' : 'Adicione arquivos. Cada um será processado de forma independente.'}
            </p>
          )}
          {lendoZips && <p className="text-sm text-slate-500 dark:text-slate-400">Lendo o conteúdo dos ZIPs…</p>}
          {errosZip.map((m) => <Alerta key={m} tom="erro" titulo={m} />)}
          {ignorados.length > 0 && <Alerta tom="alerta" titulo={`${plural(ignorados.length, 'arquivo ignorado', 'arquivos ignorados')} (formato não aceito: envie PDF, XML, JPG, PNG ou ZIP)`} itens={ignorados} />}
          {excedeBytes && <Alerta tom="erro" titulo="O lote passa de 250 MB. Divida em mais de um envio." />}
          {previa?.excedeLimite && <Alerta tom="erro" titulo={`O lote tem ${previa.total_documentos} documentos. O limite é ${MAX_DOCUMENTOS} por envio.`} />}
          {previa && previa.duplicados.length > 0 && <Alerta tom="erro" titulo={`${plural(previa.duplicados.length, 'arquivo repetido', 'arquivos repetidos')} no mesmo caminho`} itens={previa.duplicados} />}
          {previa && previa.soltos.length > 0 && (
            <Alerta tom="alerta" titulo={`${plural(previa.soltos.length, 'arquivo está', 'arquivos estão')} fora de uma pasta de operação`} itens={previa.soltos}>
              <p className="mt-1 text-xs">Com o agrupamento ativado, todo arquivo precisa estar dentro de uma pasta. Remova esses arquivos e use “Selecionar pasta”, ou desative o agrupamento.</p>
            </Alerta>
          )}
          {previaValida(previa) && !errosZip.length && !excedeBytes && (
            agrupar ? (
              <div className="space-y-3">
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="size-4" /> {plural(previa.total_operacoes, 'operação', 'operações')} · {plural(previa.total_documentos, 'documento', 'documentos')}
                  {unicos > 0 && unicos < previa.total_operacoes && <span className="text-xs font-normal text-slate-500 dark:text-slate-400">({plural(unicos, 'operação tem', 'operações têm')} só 1 documento)</span>}
                </p>
                {unicos > 1 && unicos === previa.total_operacoes && (
                  <Alerta tom="alerta" titulo="Todas as operações têm só 1 documento">
                    <p className="mt-1 text-xs">Confira se você selecionou a pasta certa: cada pasta deve conter todos os documentos de uma operação.</p>
                  </Alerta>
                )}
                <ListaOperacoes grupos={previa.grupos} />
              </div>
            ) : (
              <p className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400">
                <CheckCircle2 className="size-4" /> {plural(previa.total_documentos, 'documento será processado', 'documentos serão processados')} individualmente.
              </p>
            )
          )}
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
          {recusados.length > 0 && <Alerta tom="alerta" titulo={`${plural(recusados.length, 'arquivo não entrou', 'arquivos não entraram')} no lote`} itens={recusados.map((r) => `${r.caminho}: ${r.motivo}`)} />}
        </div>

        {arquivos.length > 0 && (
          <div className="mt-4">
            <p className="lastro-rotulo mb-1 text-slate-500 dark:text-slate-400">{plural(arquivos.length, 'arquivo selecionado', 'arquivos selecionados')}</p>
            <ul className="rolagem-fina max-h-44 divide-y divide-slate-100 overflow-y-auto rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-800">
              {arquivos.slice(0, 200).map((a) => (
                <li key={a.id} className="flex items-center gap-2 px-3 py-1.5">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={a.caminho}>{a.caminho}</span>
                  {zips[a.id] && !zips[a.id].carregando && !zips[a.id].erro && <span className="text-[11px] text-slate-500">{plural(zips[a.id].caminhos.length, 'documento', 'documentos')}</span>}
                  <button type="button" disabled={!!envio} aria-label={`Remover ${a.caminho}`} className="text-slate-400 hover:text-rose-600"
                    onClick={() => { setArquivos((x) => x.filter((y) => y.id !== a.id)); setZips((x) => { const { [a.id]: _, ...resto } = x; void _; return resto; }); }}>
                    <X className="size-3.5" />
                  </button>
                </li>
              ))}
              {arquivos.length > 200 && <li className="px-3 py-1.5 text-xs text-slate-500">e mais {arquivos.length - 200}…</li>}
            </ul>
          </div>
        )}

        {envio && (
          <div className="mt-4 text-sm">
            Salvando documentos {envio.enviados}/{envio.total}…
            <div className="mt-1 h-1.5 overflow-hidden rounded bg-slate-200 dark:bg-slate-800">
              <div className="h-full bg-indigo-600 transition-all" style={{ width: `${(100 * envio.enviados) / Math.max(1, envio.total)}%` }} />
            </div>
          </div>
        )}

        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Botao variante="fantasma" onClick={limpar} disabled={!!envio || (!arquivos.length && !ignorados.length)}><Trash2 className="size-4" /> Limpar</Botao>
          <Botao variante="primario" onClick={processar} disabled={!podeProcessar}><Play className="size-4" /> {envio ? 'Salvando documentos…' : 'Processar Documentos'}</Botao>
        </div>
      </Secao>

      {lotes.map((id) => <ProgressoLote key={id} loteId={id} />)}
    </>
  );
}
