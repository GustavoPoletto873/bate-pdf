'use client';

import { useEffect, useMemo, useState } from 'react';
import { CloudDownload, Download, FileText, Layers, Loader2, Search } from 'lucide-react';
import { Secao, Vazio } from '@/components/Pagina';
import { Aviso, Botao, Dialogo, Etiqueta, cx } from '@/components/ui';
import { IconeRabisco } from '@/components/rabiscos';
import { ErroApi } from '@/lib/cliente';
import { relatoriosApi, type FundoParaEmissao, type ItemHistorico, type Rascunho, type ResultadoLote, type TipoRelatorio, type Trimestre } from '@/lib/cliente/relatorios';
import { RevisaoRelatorio, ROTULO_CENARIO } from './RevisaoRelatorio';

type Mensagem = { tipo: 'ok' | 'erro' | 'info' | 'alerta'; texto: string } | null;
const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

/**
 * Gestão › Relatórios CVM/NIX (pages/Relatorios do Bate Lastro): trimestre → data-base →
 * fundos (com o cenário que a emissão vai dar) → revisar → emitir, um a um ou em lote.
 */
export function TelaRelatorios() {
  const [trimestres, setTrimestres] = useState<Trimestre[]>([]);
  const [trimestre, setTrimestre] = useState('');
  const [dataBase, setDataBase] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtroAdm, setFiltroAdm] = useState('');
  const [filtroTipo, setFiltroTipo] = useState('');
  const [fundos, setFundos] = useState<FundoParaEmissao[] | null>(null);
  const [historico, setHistorico] = useState<ItemHistorico[]>([]);
  const [versao, setVersao] = useState(0);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [mensagem, setMensagem] = useState<Mensagem>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [lote, setLote] = useState<ResultadoLote | null>(null);
  const [tiposLote, setTiposLote] = useState<TipoRelatorio[]>(['CVM', 'NIX']);

  useEffect(() => {
    let ativo = true;
    relatoriosApi.listar(dataBase, busca)
      .then((r) => {
        if (!ativo) return;
        setTrimestres(r.trimestres);
        setFundos(r.fundos);
        setHistorico(r.historico);
        if (!dataBase && r.data_base) {
          setDataBase(r.data_base);
          setTrimestre(r.trimestres.find((t) => t.datas_base.some((d) => d.data_base === r.data_base))?.trimestre_curto ?? '');
        }
      })
      .catch((e) => { if (ativo) setMensagem({ tipo: 'erro', texto: e instanceof ErroApi ? e.message : 'Não foi possível carregar os fundos.' }); });
    return () => { ativo = false; };
  }, [dataBase, busca, versao]);

  const recarregar = () => setVersao((v) => v + 1);
  const opcoesData = trimestres.find((t) => t.trimestre_curto === trimestre)?.datas_base ?? [];
  const antecipada = opcoesData.find((d) => d.data_base === dataBase)?.antecipada ?? false;
  const administradores = useMemo(() => [...new Set((fundos ?? []).map((f) => f.administrador))].sort(), [fundos]);
  const visiveis = (fundos ?? []).filter((f) => (!filtroAdm || f.administrador === filtroAdm) && (!filtroTipo || f.tipo === filtroTipo));
  const semCarteira = (fundos ?? []).filter((f) => !f.tem_carteira).length;

  const avisar = (tipo: NonNullable<Mensagem>['tipo'], texto: string) => setMensagem({ tipo, texto });

  const coletar = async (forcar = false) => {
    if (!dataBase) return;
    setOcupado('coletar');
    try {
      const r = await relatoriosApi.coletar(dataBase, forcar);
      avisar(r.sem_carteira ? 'alerta' : 'ok', `Carteira coletada de ${r.com_carteira} de ${r.fundos} fundo(s).${r.sem_carteira ? ` ${r.sem_carteira} sem informe na CVM nesta data-base (confira o CNPJ).` : ''}`);
      recarregar();
    } catch (e) {
      avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível coletar as carteiras.');
    } finally {
      setOcupado(null);
    }
  };

  const revisar = async (f: FundoParaEmissao) => {
    if (!dataBase) return;
    setOcupado(`fundo-${f.id}`);
    try {
      setRascunho(f.rascunho_id ? await relatoriosApi.rascunho(f.rascunho_id) : await relatoriosApi.preparar(f.id, dataBase, antecipada));
      recarregar();
    } catch (e) {
      avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível preparar o relatório.');
    } finally {
      setOcupado(null);
    }
  };

  const emitirLote = async () => {
    if (!dataBase || !selecionados.size) return;
    setOcupado('lote');
    try {
      const r = await relatoriosApi.lote([...selecionados], dataBase, tiposLote, { antecipada });
      setLote(r);
      setSelecionados(new Set());
      recarregar();
    } catch (e) {
      avisar('erro', e instanceof ErroApi ? e.message : 'Não foi possível emitir o lote.');
    } finally {
      setOcupado(null);
    }
  };

  return (
    <div className="space-y-6">
      {mensagem && (
        <div className="relative"><Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso><button type="button" className="absolute right-3 top-2 text-slate-500" onClick={() => setMensagem(null)} aria-label="Fechar">×</button></div>
      )}

      <Secao titulo="Período" descricao="Cada trimestre oferece o mês de fechamento e o anterior (amostra antecipada). Só aparecem meses que a CVM já pode ter publicado.">
        <div className="flex flex-wrap items-end gap-4">
          <label>
            <span className="lastro-rotulo mb-1 block text-slate-500 dark:text-slate-400">Trimestre</span>
            <select className="lastro-campo h-10 min-w-[220px] px-3 text-sm" value={trimestre} onChange={(e) => {
              setTrimestre(e.target.value);
              const t = trimestres.find((x) => x.trimestre_curto === e.target.value);
              if (t) { setDataBase(t.datas_base[0].data_base); setFundos(null); setSelecionados(new Set()); }
            }}>
              {trimestres.map((t) => <option key={t.trimestre_curto} value={t.trimestre_curto}>{t.trimestre}</option>)}
            </select>
          </label>
          <div>
            <span className="lastro-rotulo mb-1 block text-slate-500 dark:text-slate-400">Data-base</span>
            <div className="flex gap-1.5">
              {opcoesData.map((d) => (
                <button key={d.data_base} type="button" onClick={() => { setDataBase(d.data_base); setFundos(null); setSelecionados(new Set()); }}
                  className={cx('h-10 rounded-xl border-[1.5px] px-4 text-sm font-semibold', dataBase === d.data_base ? 'border-slate-900 bg-slate-900 text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900' : 'border-slate-300 hover:border-slate-500 dark:border-slate-700')}>
                  {d.rotulo}{d.antecipada && <span className="ml-1 text-xs font-normal opacity-80">antecipada</span>}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto flex gap-2">
            <Botao onClick={() => coletar(false)} disabled={!dataBase || Boolean(ocupado)} title="Baixa o informe mensal FIDC da CVM (dados abertos) e guarda a carteira de cada fundo">
              {ocupado === 'coletar' ? <Loader2 className="size-4 animate-spin" /> : <CloudDownload className="size-4" />} Coletar carteiras
            </Botao>
            <Botao variante="fantasma" onClick={() => coletar(true)} disabled={!dataBase || Boolean(ocupado)} title="Baixa o informe de novo, mesmo já tendo">Atualizar coleta</Botao>
          </div>
        </div>
        {fundos && semCarteira > 0 && fundos.length > 0 && <p className="mt-3 text-xs text-slate-500">{semCarteira} fundo(s) com carteira não coletada nesta data-base. “Coletar carteiras” baixa o informe da CVM (precisa de internet).</p>}
      </Secao>

      <Secao
        titulo="Fundos"
        acoes={selecionados.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold">{selecionados.size} selecionado(s)</span>
            {(['CVM', 'NIX'] as const).map((t) => (
              <label key={t} className="flex items-center gap-1"><input type="checkbox" checked={tiposLote.includes(t)} onChange={(e) => setTiposLote(e.target.checked ? [...tiposLote, t] : tiposLote.filter((x) => x !== t))} /> {t}</label>
            ))}
            <Botao variante="primario" disabled={!tiposLote.length || ocupado === 'lote'} onClick={emitirLote}>
              {ocupado === 'lote' ? <Loader2 className="size-4 animate-spin" /> : <Layers className="size-4" />} Emitir em lote
            </Botao>
          </div>
        )}
      >
        <div className="mb-4 grid gap-3 md:grid-cols-[1fr_220px_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
            <input className="lastro-campo h-10 w-full pl-9 pr-3 text-sm" placeholder="Buscar fundo por nome ou CNPJ" value={busca} onChange={(e) => setBusca(e.target.value)} />
          </div>
          <select className="lastro-campo h-10 px-3 text-sm" value={filtroAdm} onChange={(e) => setFiltroAdm(e.target.value)} aria-label="Administrador">
            <option value="">Todos os administradores</option>
            {administradores.map((a) => <option key={a}>{a}</option>)}
          </select>
          <select className="lastro-campo h-10 px-3 text-sm" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} aria-label="Tipo de fundo">
            <option value="">Todos os tipos de fundo</option><option value="FIDC">FIDC</option><option value="FIC_FIDC">FIC FIDC</option>
          </select>
        </div>

        {!fundos ? (
          <p className="flex items-center gap-2 py-6 text-sm text-slate-500"><Loader2 className="size-4 animate-spin" /> Carregando os fundos…</p>
        ) : !fundos.length ? (
          <Vazio icone={<IconeRabisco tipo="pdf" tamanho={40} />} titulo={busca ? 'Nenhum fundo com essa busca' : 'Nenhum fundo cadastrado'}>
            Os relatórios saem dos fundos cadastrados em Gestão › Fundos, com a carteira do informe mensal da CVM e a base de auditoria do trimestre.
          </Vazio>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-500 dark:bg-slate-900 dark:text-slate-400">
                <tr>
                  <th className="w-8 px-3 py-2"><input type="checkbox" aria-label="Selecionar todos" checked={visiveis.length > 0 && visiveis.every((f) => selecionados.has(f.id))} onChange={(e) => setSelecionados(e.target.checked ? new Set(visiveis.map((f) => f.id)) : new Set())} /></th>
                  <th className="px-3 py-2">Fundo</th><th className="px-3 py-2">CNPJ</th><th className="px-3 py-2">Tipo</th><th className="px-3 py-2">Administrador</th>
                  <th className="px-3 py-2">Carteira</th><th className="px-3 py-2">Cenário</th><th className="px-3 py-2">Emitidos</th><th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {visiveis.map((f) => {
                  const cen = f.cenario ? ROTULO_CENARIO[f.cenario] : null;
                  return (
                    <tr key={f.id} className="border-t border-slate-100 dark:border-slate-800">
                      <td className="px-3 py-2"><input type="checkbox" checked={selecionados.has(f.id)} onChange={() => setSelecionados((s) => { const n = new Set(s); if (n.has(f.id)) n.delete(f.id); else n.add(f.id); return n; })} aria-label={`Selecionar ${f.nome}`} /></td>
                      <td className="px-3 py-2 font-semibold">{f.nome}{f.base_nome && <span className="block text-xs font-normal text-slate-500" title="Base de auditoria do trimestre">{f.base_nome}</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2 font-mono text-xs">{f.cnpj}</td>
                      <td className="px-3 py-2">{f.tipo === 'FIC_FIDC' ? 'FIC FIDC' : 'FIDC'}</td>
                      <td className="px-3 py-2 text-slate-600 dark:text-slate-400">{f.administrador}</td>
                      <td className="px-3 py-2">{f.tem_carteira ? <Etiqueta cor="emerald">coletada</Etiqueta> : <span className="text-xs text-slate-400">não coletada</span>}</td>
                      <td className="px-3 py-2">{cen ? <Etiqueta cor={cen.cor} titulo={cen.dica}>{cen.curto}</Etiqueta> : <span className="text-xs text-slate-400">—</span>}</td>
                      <td className="px-3 py-2 text-xs">{f.emitidos.length ? f.emitidos.map((e) => e.tipo).join(' · ') : <span className="text-slate-400">—</span>}</td>
                      <td className="px-3 py-2 text-right">
                        <Botao tamanho="sm" onClick={() => revisar(f)} disabled={Boolean(ocupado)}>
                          {ocupado === `fundo-${f.id}` ? <Loader2 className="size-3.5 animate-spin" /> : <FileText className="size-3.5" />} {f.rascunho_id ? 'Revisar' : 'Preparar'}
                        </Botao>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Secao>

      {historico.length > 0 && (
        <Secao titulo="Emitidos recentemente">
          <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
            {historico.slice(0, 15).map((h) => (
              <li key={h.id} className="flex flex-wrap items-center gap-3 py-2">
                <Etiqueta cor={h.tipo === 'CVM' ? 'indigo' : 'violet'}>{h.tipo}</Etiqueta>
                <span className="font-semibold">{h.fundo}</span>
                <span className="text-slate-500">data-base {h.data_base.split('-').reverse().join('/')}</span>
                {h.sem_pendencias ? <Etiqueta cor="slate">sem pendências</Etiqueta> : null}
                <span className="ml-auto text-xs text-slate-500">{dataHora(h.criado_em)}</span>
                <a className="flex items-center gap-1 text-indigo-700 hover:underline dark:text-indigo-300" href={relatoriosApi.urlEmissao(h.id)} download><Download className="size-4" /> .docx</a>
              </li>
            ))}
          </ul>
        </Secao>
      )}

      <Dialogo aberto={Boolean(rascunho)} titulo={rascunho ? `${rascunho.snapshot.fundo.nome} — ${rascunho.snapshot.trimestre_curto}` : ''} onFechar={() => setRascunho(null)} largura="max-w-6xl">
        {rascunho && <RevisaoRelatorio key={rascunho.id + rascunho.revisao} inicial={rascunho} onAtualizado={recarregar} onAvisar={avisar} />}
      </Dialogo>

      <Dialogo aberto={Boolean(lote)} titulo="Emissão em lote" onFechar={() => setLote(null)} largura="max-w-2xl"
        rodape={lote && lote.emitidos.length > 0 && <a className="lastro-botao lastro-botao-md lastro-botao-primario" href={relatoriosApi.urlLote(lote.lote_id)} download><Download className="size-4" /> Baixar todos (.zip)</a>}>
        {lote && (
          <div className="space-y-3 text-sm">
            <p>{lote.emitidos.length} relatório(s) emitido(s){lote.erros.length ? `, ${lote.erros.length} fundo(s) com problema` : ''}.</p>
            {lote.erros.length > 0 && (
              <Aviso tipo="alerta"><ul className="list-disc pl-4">{lote.erros.map((e) => <li key={e.fundo}><b>{e.fundo}</b>: {e.erro}</li>)}</ul></Aviso>
            )}
            <ul className="space-y-1">{lote.emitidos.map((e) => <li key={e.id}><a className="text-indigo-700 hover:underline dark:text-indigo-300" href={relatoriosApi.urlEmissao(e.id)} download>{e.nome_arquivo}</a></li>)}</ul>
          </div>
        )}
      </Dialogo>
    </div>
  );
}
