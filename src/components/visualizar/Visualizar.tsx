'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Columns3, Download, Eraser, ExternalLink, Search } from 'lucide-react';
import { ErroApi } from '@/lib/cliente';
import { apiVisualizar, type FiltrosLeituras, type PaginaLeituras } from '@/lib/cliente/visualizar';
import type { Leitura } from '@/lib/leituras';
import { formatarData, formatarMoeda } from '@/lib/valores';
import { Aviso, Botao, cx, Etiqueta } from '@/components/ui';
import { Secao } from '@/components/Pagina';
import { rotuloTipo } from '@/components/anexo/rotulos';

/** As 15 colunas do Bate Lastro (PlanilhaLogs.jsx). */
const COLUNAS: { chave: string; coluna: keyof Leitura; rotulo: string; tipo?: 'moeda' | 'data' | 'tipo' | 'mono' }[] = [
  { chave: 'NOME_CESSIONARIO', coluna: 'cessionario_nome', rotulo: 'Nome Cessionário' },
  { chave: 'DOC_CESSIONARIO', coluna: 'cessionario_documento', rotulo: 'Doc Cessionário', tipo: 'mono' },
  { chave: 'NOME_CEDENTE', coluna: 'cedente_nome', rotulo: 'Nome Cedente' },
  { chave: 'DOC_CEDENTE', coluna: 'cedente_documento', rotulo: 'Doc Cedente', tipo: 'mono' },
  { chave: 'NOME_SACADO', coluna: 'sacado_nome', rotulo: 'Nome Sacado' },
  { chave: 'DOC_SACADO', coluna: 'sacado_documento', rotulo: 'Doc Sacado', tipo: 'mono' },
  { chave: 'NU_DOCUMENTO', coluna: 'numero_documento', rotulo: 'Nº Documento', tipo: 'mono' },
  { chave: 'QUANTIDADE_PARCELAS', coluna: 'quantidade_parcelas', rotulo: 'Qtd Parcelas' },
  { chave: 'NUMERO_PARCELA', coluna: 'numero_parcela', rotulo: 'Nº Parcela' },
  { chave: 'VALOR_NOMINAL', coluna: 'valor_nominal', rotulo: 'Valor Nominal', tipo: 'moeda' },
  { chave: 'DATA_AQUISICAO', coluna: 'data_aquisicao', rotulo: 'Data Aquisição', tipo: 'data' },
  { chave: 'DATA_EMISSAO', coluna: 'data_emissao', rotulo: 'Data Emissão', tipo: 'data' },
  { chave: 'DATA_VENCIMENTO_ORIGINAL', coluna: 'data_vencimento', rotulo: 'Data Vencimento', tipo: 'data' },
  { chave: 'OPERACAO_ID', coluna: 'operacao_id', rotulo: 'Operação ID', tipo: 'mono' },
  { chave: 'TIPO_RECEBIVEL', coluna: 'tipo_recebivel', rotulo: 'Tipo Recebível', tipo: 'tipo' },
];

const VAZIO: FiltrosLeituras = {};

type CampoFiltro = { nome: keyof FiltrosLeituras; rotulo: string; tipo?: 'date'; placeholder?: string };

const LINHA_1: CampoFiltro[] = [
  { nome: 'nome_cessionario', rotulo: 'Nome Cessionário', placeholder: 'Digite o nome' },
  { nome: 'doc_cessionario', rotulo: 'Doc Cessionário', placeholder: 'Digite o documento' },
  { nome: 'nome_sacado', rotulo: 'Nome Sacado', placeholder: 'Digite o nome' },
  { nome: 'doc_sacado', rotulo: 'Doc Sacado', placeholder: 'Digite o documento' },
  { nome: 'nome_cedente', rotulo: 'Nome Cedente', placeholder: 'Digite o nome' },
  { nome: 'doc_cedente', rotulo: 'Doc Cedente', placeholder: '00.000.000/0000-00' },
];
const LINHA_2: CampoFiltro[] = [
  { nome: 'numero_documento', rotulo: 'Número Documento', placeholder: 'Nº do documento' },
  { nome: 'base', rotulo: 'Base', placeholder: 'Nome ou ID da base' },
  { nome: 'aquisicao_de', rotulo: 'Aquisição de', tipo: 'date' },
  { nome: 'aquisicao_ate', rotulo: 'Aquisição até', tipo: 'date' },
  { nome: 'emissao_de', rotulo: 'Emissão de', tipo: 'date' },
  { nome: 'emissao_ate', rotulo: 'Emissão até', tipo: 'date' },
  { nome: 'data_leitura', rotulo: 'Data de Leitura', tipo: 'date' },
];

function valorCelula(l: Leitura, c: (typeof COLUNAS)[number]) {
  const v = l[c.coluna];
  if (v === null || v === undefined || v === '') return <span className="text-slate-400">-</span>;
  if (c.tipo === 'moeda') return formatarMoeda(String(v));
  if (c.tipo === 'data') return formatarData(String(v));
  if (c.tipo === 'tipo') return <Etiqueta cor={String(v).startsWith('termo_cessao') ? 'emerald' : 'sky'}>{rotuloTipo(String(v))}</Etiqueta>;
  return String(v);
}

export function Visualizar() {
  const [rascunho, setRascunho] = useState<FiltrosLeituras>(VAZIO);
  const [aplicados, setAplicados] = useState<FiltrosLeituras>(VAZIO);
  const [pagina, setPagina] = useState(1);
  const [ordem, setOrdem] = useState<{ coluna: string; direcao: 'asc' | 'desc' }>({ coluna: 'lida_em', direcao: 'desc' });
  const [dados, setDados] = useState<PaginaLeituras | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [visiveis, setVisiveis] = useState<string[]>(COLUNAS.map((c) => c.chave));
  const [menuColunas, setMenuColunas] = useState(false);
  const [exportando, setExportando] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async (f: FiltrosLeituras, p: number, o: { coluna: string; direcao: 'asc' | 'desc' }) => {
    setCarregando(true);
    try {
      setDados(await apiVisualizar.leituras(f, p, o.coluna, o.direcao));
      setErro(null);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Erro ao carregar os dados. Tente novamente.');
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => { void carregar(aplicados, pagina, ordem); }, 0);
    return () => clearTimeout(t);
  }, [aplicados, pagina, ordem, carregar]);

  useEffect(() => {
    if (!menuColunas) return;
    const fora = (e: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuColunas(false); };
    document.addEventListener('mousedown', fora);
    return () => document.removeEventListener('mousedown', fora);
  }, [menuColunas]);

  function filtrar(e: React.FormEvent) {
    e.preventDefault();
    const f: FiltrosLeituras = {};
    for (const [k, v] of Object.entries(rascunho)) if (v && String(v).trim()) f[k as keyof FiltrosLeituras] = String(v).trim();
    setAplicados(f);
    setPagina(1);
  }

  function limpar() {
    setRascunho(VAZIO);
    setAplicados(VAZIO);
    setPagina(1);
  }

  function ordenar(coluna: string) {
    setOrdem((o) => ({ coluna, direcao: o.coluna === coluna && o.direcao === 'asc' ? 'desc' : 'asc' }));
    setPagina(1);
  }

  async function exportar() {
    setExportando(true);
    setErro(null);
    try {
      const r = await fetch(apiVisualizar.urlExportar(aplicados, visiveis, ordem.coluna, ordem.direcao));
      if (!r.ok) {
        const corpo = await r.json().catch(() => null) as { erro?: string } | null;
        throw new ErroApi(corpo?.erro ?? 'Não foi possível gerar o Excel.', r.status);
      }
      const nome = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'leituras.xlsx';
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement('a');
      a.href = url;
      a.download = nome;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Sem conexão com o servidor do Lastro. Ele está rodando?');
    } finally {
      setExportando(false);
    }
  }

  const ativos = Object.keys(aplicados).length;
  const colunas = COLUNAS.filter((c) => visiveis.includes(c.chave));
  const campo = (c: CampoFiltro) => (
    <label key={c.nome} className="block">
      <span className="lastro-rotulo text-slate-600 dark:text-slate-400">{c.rotulo}</span>
      <input
        type={c.tipo ?? 'text'} placeholder={c.placeholder} autoComplete="off" spellCheck={false}
        className="lastro-campo mt-1 h-9 w-full px-3 text-sm"
        value={rascunho[c.nome] ?? ''}
        onChange={(e) => setRascunho((x) => ({ ...x, [c.nome]: e.target.value }))}
      />
    </label>
  );

  return (
    <div className="space-y-6">
      <Secao
        titulo={<span className="flex items-center gap-2">Filtros {ativos > 0 && <Etiqueta cor="emerald">✓ {ativos} filtro{ativos !== 1 ? 's' : ''} ativo{ativos !== 1 ? 's' : ''}</Etiqueta>}</span>}
        descricao="Utilize os filtros para refinar sua busca. Texto parcial, sem diferenciar maiúsculas nem acentos; documento pode ser só os dígitos."
      >
        <form onSubmit={filtrar} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">{LINHA_1.map(campo)}</div>
          <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">{LINHA_2.map(campo)}</div>
          <div className="flex flex-wrap justify-end gap-2">
            <Botao variante="fantasma" onClick={limpar}><Eraser className="size-4" /> Limpar Filtros</Botao>
            <Botao variante="primario" type="submit"><Search className="size-4" /> Filtrar</Botao>
          </div>
        </form>
      </Secao>

      <Secao
        titulo="Leituras"
        descricao={dados ? `${dados.total.toLocaleString('pt-BR')} registro(s)` : undefined}
        acoes={<>
          <div className="relative" ref={menuRef}>
            <Botao tamanho="sm" onClick={() => setMenuColunas((x) => !x)}><Columns3 className="size-3.5" /> Colunas</Botao>
            {menuColunas && (
              <div className="lastro-cartao absolute right-0 z-20 mt-2 w-56 p-3">
                <label className="flex items-center gap-2 border-b border-slate-200 pb-2 text-sm font-semibold dark:border-slate-700">
                  <input type="checkbox" checked={visiveis.length === COLUNAS.length} onChange={(e) => setVisiveis(e.target.checked ? COLUNAS.map((c) => c.chave) : [])} />
                  Selecionar Tudo
                </label>
                <div className="mt-2 max-h-72 space-y-1 overflow-y-auto">
                  {COLUNAS.map((c) => (
                    <label key={c.chave} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={visiveis.includes(c.chave)}
                        onChange={(e) => setVisiveis((v) => (e.target.checked ? COLUNAS.map((x) => x.chave).filter((k) => k === c.chave || v.includes(k)) : v.filter((k) => k !== c.chave)))} />
                      {c.rotulo}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <Botao tamanho="sm" variante="sucesso" onClick={exportar} disabled={exportando || !dados?.total}><Download className="size-3.5" /> {exportando ? 'Gerando…' : 'Exportar Excel'}</Botao>
        </>}
      >
        {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
        <div className="rolagem-fina overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="min-w-full text-xs">
            <thead className="bg-slate-50 dark:bg-slate-900">
              <tr>
                {colunas.map((c) => (
                  <th key={c.chave} className="whitespace-nowrap px-3 py-2 text-left">
                    <button type="button" onClick={() => ordenar(c.coluna)} className="lastro-rotulo inline-flex items-center gap-1 text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100">
                      {c.rotulo}
                      {ordem.coluna === c.coluna && (ordem.direcao === 'asc' ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />)}
                    </button>
                  </th>
                ))}
                <th className="lastro-rotulo px-3 py-2 text-left text-slate-600 dark:text-slate-400">Ações</th>
              </tr>
            </thead>
            <tbody className={cx('divide-y divide-slate-100 dark:divide-slate-800', carregando && 'opacity-60')}>
              {dados?.linhas.map((l) => (
                <tr key={l.id} className="hover:bg-slate-50 dark:hover:bg-slate-900">
                  {colunas.map((c) => <td key={c.chave} className={cx('whitespace-nowrap px-3 py-2', c.tipo === 'mono' && 'font-mono text-[11px]', c.tipo === 'moeda' && 'tabular-nums')}>{valorCelula(l, c)}</td>)}
                  <td className="px-3 py-2">
                    {l.pdf_id ? (
                      <a href={`/api/pdfs/${l.pdf_id}/arquivo`} target="_blank" rel="noreferrer" title={`Visualizar PDF${l.pdf_nome ? `: ${l.pdf_nome}` : ''}`}
                        className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400">
                        <ExternalLink className="size-3.5" /> PDF
                      </a>
                    ) : <span className="text-slate-400">-</span>}
                  </td>
                </tr>
              ))}
              {dados && !dados.linhas.length && (
                <tr><td colSpan={colunas.length + 1} className="px-3 py-10 text-center text-sm text-slate-500 dark:text-slate-400">
                  Nenhum resultado encontrado. {ativos ? 'Ajuste os filtros.' : 'Processe documentos em Gestão › Anexo para ver as leituras aqui.'}
                </td></tr>
              )}
              {!dados && carregando && <tr><td colSpan={colunas.length + 1} className="px-3 py-10 text-center text-sm text-slate-500">Carregando dados…</td></tr>}
            </tbody>
          </table>
        </div>
        {dados && dados.paginas > 1 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-slate-600 dark:text-slate-400">Página {dados.pagina} de {dados.paginas}</span>
            <div className="flex gap-1">
              <Botao tamanho="sm" onClick={() => setPagina(1)} disabled={dados.pagina <= 1} title="Primeira página">«</Botao>
              <Botao tamanho="sm" onClick={() => setPagina(dados.pagina - 1)} disabled={dados.pagina <= 1}>Anterior</Botao>
              <Botao tamanho="sm" onClick={() => setPagina(dados.pagina + 1)} disabled={dados.pagina >= dados.paginas}>Próxima</Botao>
              <Botao tamanho="sm" onClick={() => setPagina(dados.paginas)} disabled={dados.pagina >= dados.paginas} title="Última página">»</Botao>
            </div>
          </div>
        )}
      </Secao>
    </div>
  );
}
