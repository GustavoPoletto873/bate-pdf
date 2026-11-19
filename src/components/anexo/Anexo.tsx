'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Copy, Recycle, Search } from 'lucide-react';
import { ErroApi } from '@/lib/cliente';
import { apiAnexo, type BaseDoAnexo, type FundoAnexo, type StatusIa } from '@/lib/cliente/anexo';
import { formatarCpfCnpj } from '@/lib/texto';
import { formatarData, formatarMoeda } from '@/lib/valores';
import { Aviso, Botao, cx, Dialogo, Etiqueta } from '@/components/ui';
import { Secao } from '@/components/Pagina';
import { EtapaUpload } from './EtapaUpload';
import { plural } from './rotulos';

type Modo = 'DATA_REFERENCIA' | 'TRIMESTRE';

/** Último dia do trimestre (getQuarterEndDate do Bate Lastro). */
function fimDoTrimestre(tri: string, ano: string): string {
  if (!tri || !/^\d{4}$/.test(ano)) return '';
  const mes = Number(tri) * 3;
  return new Date(Date.UTC(Number(ano), mes, 0)).toISOString().slice(0, 10);
}

function ResumoContexto({ itens }: { itens: { rotulo: string; valor: string | null | undefined; mono?: boolean }[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 rounded-xl border-2 border-dashed border-slate-300 p-4 sm:grid-cols-2 lg:grid-cols-4 dark:border-slate-700">
      {itens.filter((i) => i.valor).map((i) => (
        <div key={i.rotulo} className="min-w-0">
          <dt className="lastro-rotulo text-slate-500 dark:text-slate-400">{i.rotulo}</dt>
          <dd className={cx('mt-0.5 truncate text-sm font-medium', i.mono && 'font-mono text-xs')} title={i.valor ?? ''}>{i.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

function Passos({ atual }: { atual: number }) {
  const passos = ['Parâmetros', 'Selecionar Base', 'Upload'];
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-3">
      {passos.map((p, i) => {
        const n = i + 1;
        return (
          <li key={p} className="flex items-center gap-2">
            <span className={cx(
              'grid size-7 place-items-center rounded-full border-2 font-display text-xs',
              n === atual ? '-rotate-6 border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                : n < atual ? 'border-emerald-600 bg-emerald-50 text-emerald-700 dark:border-emerald-400 dark:bg-emerald-500/15 dark:text-emerald-300'
                  : 'border-slate-300 text-slate-400 dark:border-slate-700 dark:text-slate-500',
            )}>{n < atual ? <Check className="size-3.5" /> : n}</span>
            <span className={cx('text-sm font-semibold', n === atual ? 'text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400')}>{p}</span>
            {n < passos.length && <span className="mx-1 h-px w-8 bg-slate-300 dark:bg-slate-700" />}
          </li>
        );
      })}
    </ol>
  );
}

function PreviaBase({ base }: { base: BaseDoAnexo }) {
  if (!base.previa.length) return <p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Base sem títulos.</p>;
  return (
    <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="min-w-full text-xs">
        <thead className="bg-slate-50 dark:bg-slate-900">
          <tr>{['Nome Cedente', 'Doc Cedente', 'Nome Sacado', 'Doc Sacado', 'Nº Documento', 'Valor Nominal'].map((c) => <th key={c} className="lastro-rotulo px-2 py-1.5 text-left text-slate-500 dark:text-slate-400">{c}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {base.previa.map((t, i) => (
            <tr key={i}>
              <td className="px-2 py-1.5">{t.cedente_nome}</td>
              <td className="px-2 py-1.5 font-mono">{t.cedente_documento ? formatarCpfCnpj(t.cedente_documento) : ''}</td>
              <td className="px-2 py-1.5">{t.sacado_nome}</td>
              <td className="px-2 py-1.5 font-mono">{t.sacado_documento ? formatarCpfCnpj(t.sacado_documento) : ''}</td>
              <td className="px-2 py-1.5 font-mono">{t.numero_documento}</td>
              <td className="px-2 py-1.5 tabular-nums">{formatarMoeda(t.valor_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-2 py-1.5 text-[11px] text-slate-500 dark:text-slate-400">Mostrando 5 de {base.titulos.toLocaleString('pt-BR')} títulos.</p>
    </div>
  );
}

export function Anexo({ baseInicial }: { baseInicial?: string | null }) {
  const [etapa, setEtapa] = useState(1);
  const [fundos, setFundos] = useState<FundoAnexo[] | null>(null);
  const [fundoId, setFundoId] = useState<number | null>(null);
  const [modo, setModo] = useState<Modo>('DATA_REFERENCIA');
  const [data, setData] = useState('');
  const [trimestre, setTrimestre] = useState('');
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [bases, setBases] = useState<BaseDoAnexo[]>([]);
  const [baseId, setBaseId] = useState<string>('');
  const [expandidas, setExpandidas] = useState<Record<string, boolean>>({});
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [statusIa, setStatusIa] = useState<StatusIa | null>(null);
  const [reaproveitar, setReaproveitar] = useState(false);
  const [origem, setOrigem] = useState('');

  const fundo = fundos?.find((f) => f.id === fundoId) ?? null;
  const dataReferencia = modo === 'TRIMESTRE' ? fimDoTrimestre(trimestre, ano) : data;
  const base = bases.find((b) => b.id === baseId) ?? null;

  useEffect(() => {
    let ativo = true;
    (async () => {
      try {
        const [f, s] = await Promise.all([apiAnexo.fundos(), apiAnexo.statusIa()]);
        if (!ativo) return;
        setFundos(f.fundos);
        setStatusIa(s);
        if (baseInicial) {
          const r = await apiAnexo.bases({ id: baseInicial });
          if (!ativo) return;
          if (r.bases.length) {
            setBases(r.bases);
            setBaseId(r.bases[0].id);
            setFundoId(r.bases[0].fundo_id);
            setEtapa(2);
          } else setErro('A base do link não foi encontrada. Escolha o fundo e a data.');
        }
      } catch (e) {
        if (ativo) setErro(e instanceof ErroApi ? e.message : 'Não foi possível carregar os fundos.');
      }
    })();
    return () => { ativo = false; };
  }, [baseInicial]);

  async function buscar(todas = false) {
    setErro(null);
    setAviso(null);
    if (!todas && (!fundoId || !dataReferencia)) {
      setErro('Selecione um fundo e preencha a data de referência.');
      return;
    }
    setOcupado(true);
    try {
      const r = await apiAnexo.bases(todas ? {} : { fundo_id: fundoId!, data: dataReferencia, modo });
      if (!r.bases.length) {
        setErro(todas ? 'Ainda não há bases. Crie uma em Gestão › Upload Base.' : 'Nenhuma base encontrada para os parâmetros informados.');
        return;
      }
      setBases(r.bases);
      setBaseId(r.bases.length === 1 ? r.bases[0].id : '');
      setExpandidas({});
      setEtapa(2);
      setAviso(`${plural(r.bases.length, 'base encontrada', 'bases encontradas')}.`);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Erro ao buscar operações. Verifique os parâmetros.');
    } finally {
      setOcupado(false);
    }
  }

  async function copiar(id: string) {
    try {
      await navigator.clipboard.writeText(id);
      setAviso('ID da base copiado.');
    } catch {
      setErro('Não foi possível copiar o ID.');
    }
  }

  async function executarReaproveitamento() {
    if (!origem || !baseId) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await apiAnexo.reaproveitar(origem, baseId);
      setAviso(r.copiadas ? `${plural(r.copiadas, 'leitura copiada', 'leituras copiadas')} para a base selecionada.` : 'Nenhuma leitura nova para copiar: a base de destino já tem todas.');
      setReaproveitar(false);
      setOrigem('');
      const atualizada = await apiAnexo.bases({ id: baseId });
      setBases((bs) => bs.map((b) => (b.id === baseId && atualizada.bases[0] ? atualizada.bases[0] : b)));
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Erro ao reaproveitar leitura.');
    } finally {
      setOcupado(false);
    }
  }

  const resumo = [
    { rotulo: 'Fundo', valor: fundo?.nome ?? base?.nome_fundo },
    { rotulo: 'CNPJ', valor: fundo ? formatarCpfCnpj(fundo.cnpj) : base?.cnpj_fundo ? formatarCpfCnpj(base.cnpj_fundo) : null },
    { rotulo: modo === 'TRIMESTRE' ? 'Trimestre' : 'Data de referência', valor: dataReferencia ? formatarData(dataReferencia) : base?.data_referencia ? formatarData(base.data_referencia) : null },
  ];
  const outrasDoFundo = bases.filter((b) => b.id !== baseId && base && ((b.fundo_id && b.fundo_id === base.fundo_id) || (b.cnpj_fundo && b.cnpj_fundo === base.cnpj_fundo)));

  return (
    <div>
      <Passos atual={etapa} />
      <div className="mb-4 space-y-2">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        {aviso && !erro && <Aviso tipo="ok">{aviso}</Aviso>}
      </div>

      {etapa === 1 && (
        <Secao titulo="Parâmetros" descricao="Escolha o fundo e o período para encontrar a base que vai receber os documentos.">
          {fundos && !fundos.length && (
            <div className="mb-4">
              <Aviso tipo="alerta">
                Nenhum fundo cadastrado. Cadastre em <Link href="/cadastro-fundo" className="font-semibold underline">Gestão › Fundos</Link>, ou use “Ver todas as bases”.
              </Aviso>
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            <label className="block">
              <span className="lastro-rotulo">Fundo</span>
              <select className="lastro-campo mt-1 h-10 w-full px-3" value={fundoId ?? ''} onChange={(e) => setFundoId(e.target.value ? Number(e.target.value) : null)} disabled={!fundos}>
                <option value="">{fundos ? 'Selecione o fundo' : 'Carregando…'}</option>
                {fundos?.map((f) => <option key={f.id} value={f.id}>{f.nome} — {formatarCpfCnpj(f.cnpj)}</option>)}
              </select>
            </label>
            <div>
              <span className="lastro-rotulo">{modo === 'TRIMESTRE' ? 'Trimestre' : 'Data de referência'}</span>
              {modo === 'DATA_REFERENCIA' ? (
                <input type="date" className="lastro-campo mt-1 h-10 w-full px-3" value={data} onChange={(e) => setData(e.target.value)} />
              ) : (
                <div className="mt-1 flex gap-2">
                  <select className="lastro-campo h-10 flex-1 px-3" value={trimestre} onChange={(e) => setTrimestre(e.target.value)}>
                    <option value="">Trimestre</option>
                    <option value="1">1º Trimestre (Mar)</option>
                    <option value="2">2º Trimestre (Jun)</option>
                    <option value="3">3º Trimestre (Set)</option>
                    <option value="4">4º Trimestre (Dez)</option>
                  </select>
                  <input className="lastro-campo h-10 w-24 px-3" inputMode="numeric" maxLength={4} value={ano} onChange={(e) => setAno(e.target.value.replace(/\D/g, ''))} aria-label="Ano" />
                </div>
              )}
              <label className="mt-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <input type="checkbox" checked={modo === 'TRIMESTRE'} onChange={(e) => setModo(e.target.checked ? 'TRIMESTRE' : 'DATA_REFERENCIA')} />
                Selecionar por trimestre
              </label>
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Botao variante="fantasma" onClick={() => buscar(true)} disabled={ocupado}>Ver todas as bases</Botao>
            <Botao variante="primario" onClick={() => buscar()} disabled={ocupado}>
              <Search className="size-4" /> {ocupado ? 'Buscando…' : 'Buscar Operações'}
            </Botao>
          </div>
        </Secao>
      )}

      {etapa === 2 && (
        <Secao titulo="Selecionar Base" descricao="A base que vai receber as leituras dos documentos.">
          <ResumoContexto itens={resumo} />
          <div role="radiogroup" aria-label="Bases disponíveis" className="mt-4 max-h-[32rem] space-y-3 overflow-y-auto pr-1">
            {bases.map((b) => {
              const marcada = b.id === baseId;
              return (
                <div key={b.id} className={cx('rounded-xl border-2 p-4 transition-colors', marcada ? 'border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-900' : 'border-slate-200 dark:border-slate-800')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                      <input type="radio" name="base" className="mt-1" checked={marcada} onChange={() => setBaseId(b.id)} />
                      <span className="min-w-0">
                        <span className="block font-semibold">{b.nome}</span>
                        <span className="block text-xs text-slate-500 dark:text-slate-400">
                          {b.nome_fundo ?? 'Fundo não identificado'}{b.data_referencia ? ` · Ref. ${formatarData(b.data_referencia)}` : ''}
                        </span>
                        <span className="mt-1 block truncate font-mono text-[11px] text-slate-500 dark:text-slate-400" title={b.id}>{b.id}</span>
                      </span>
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                      <Etiqueta>{plural(b.titulos, 'título', 'títulos')}</Etiqueta>
                      <Etiqueta cor={b.leituras ? 'emerald' : 'slate'}>{plural(b.leituras, 'leitura', 'leituras')}</Etiqueta>
                      <Botao tamanho="sm" variante="fantasma" onClick={() => copiar(b.id)} title="Copiar ID da base"><Copy className="size-3.5" /> Copiar ID</Botao>
                      <Botao tamanho="sm" variante="fantasma" onClick={() => setExpandidas((x) => ({ ...x, [b.id]: !x[b.id] }))}>
                        {expandidas[b.id] ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />} {expandidas[b.id] ? 'Ocultar dados' : 'Ver dados'}
                      </Botao>
                    </div>
                  </div>
                  {expandidas[b.id] && <PreviaBase base={b} />}
                </div>
              );
            })}
          </div>
          <div className="mt-5 flex flex-wrap justify-between gap-2">
            <Botao onClick={() => { setEtapa(1); setAviso(null); }}><ArrowLeft className="size-4" /> Voltar</Botao>
            <div className="flex flex-wrap gap-2">
              <Botao onClick={() => setReaproveitar(true)} disabled={!base || !outrasDoFundo.length}
                title={!outrasDoFundo.length ? 'Precisa de outra base do mesmo fundo na lista' : undefined}>
                <Recycle className="size-4" /> Reaproveitar Leitura de outra Base
              </Botao>
              <Botao variante="primario" onClick={() => { setEtapa(3); setAviso(null); }} disabled={!base}>Continuar <ArrowRight className="size-4" /></Botao>
            </div>
          </div>
        </Secao>
      )}

      {etapa === 3 && base && (
        <div className="space-y-6">
          <ResumoContexto itens={[...resumo, { rotulo: 'Base', valor: `${base.nome} (${base.id})`, mono: true }]} />
          {statusIa && !statusIa.configurada && (
            <Aviso tipo="alerta">
              A chave do Gemini não está configurada: os PDFs vão terminar com erro até você configurar <code>GEMINI_API_KEY</code> (veja em{' '}
              <Link href="/perfil" className="font-semibold underline">Perfil</Link>) e usar “Tentar de novo”. Os XML de NF-e são lidos mesmo sem a chave.
            </Aviso>
          )}
          <EtapaUpload base={base} onVoltar={() => setEtapa(2)} />
        </div>
      )}

      <Dialogo
        aberto={reaproveitar}
        titulo="Reaproveitar Leitura de outra Base"
        onFechar={() => setReaproveitar(false)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setReaproveitar(false)}>Cancelar</Botao>
          <Botao variante="primario" onClick={executarReaproveitamento} disabled={!origem || ocupado}>Reaproveitar Leitura</Botao>
        </>}
      >
        <p className="font-serif text-sm text-slate-600 dark:text-slate-400">
          Copia para <b>{base?.nome}</b> as leituras de outra base do mesmo fundo, para os mesmos PDFs não precisarem ser lidos de novo.
          Não repete título que a base de destino já tem; leituras vindas de planilha não entram.
        </p>
        <label className="mt-4 block">
          <span className="lastro-rotulo">Base de origem</span>
          <select className="lastro-campo mt-1 h-10 w-full px-3" value={origem} onChange={(e) => setOrigem(e.target.value)}>
            <option value="">Selecione</option>
            {outrasDoFundo.map((b) => <option key={b.id} value={b.id}>{b.nome}{b.data_referencia ? ` — ${formatarData(b.data_referencia)}` : ''} ({plural(b.leituras, 'leitura', 'leituras')})</option>)}
          </select>
        </label>
      </Dialogo>
    </div>
  );
}
