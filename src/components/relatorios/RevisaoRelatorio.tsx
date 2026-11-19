'use client';

import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, RefreshCw, Save } from 'lucide-react';
import { Aviso, Botao, Etiqueta, cx } from '@/components/ui';
import { ErroApi } from '@/lib/cliente';
import { relatoriosApi, type Emitido, type Rascunho, type TipoRelatorio } from '@/lib/cliente/relatorios';

const moeda = (v: number) => v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (v: number) => `${(v * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const contabil = (v: number) => (v === 0 ? '-' : v < 0 ? `(${moeda(-v)})` : moeda(v));

export const ROTULO_CENARIO: Record<string, { texto: string; curto: string; cor: 'sky' | 'slate' | 'amber' | 'emerald'; dica: string }> = {
  COM_DC: { texto: 'Com direitos creditórios', curto: 'Com DC', cor: 'sky', dica: 'Tem direitos creditórios e base de auditoria. Se a amostra do trimestre vier vazia, sai como sem movimentação.' },
  SEM_DC: { texto: 'Sem direitos creditórios', curto: 'Sem DC', cor: 'slate', dica: 'A carteira não tem direitos creditórios: sem estoque, não há amostra.' },
  SEM_MOVIMENTACAO: { texto: 'Sem movimentação', curto: 'Sem movimentação', cor: 'slate', dica: 'Tem direitos creditórios, mas nenhuma aquisição no período para amostrar.' },
  SEM_BASE: { texto: 'Sem base de auditoria', curto: 'Sem base', cor: 'amber', dica: 'Tem direitos creditórios, mas nenhuma base de auditoria foi enviada no trimestre. Envie a base ou marque para emitir como sem movimentação.' },
};

function Bloco({ titulo, children, acoes }: { titulo: string; children: React.ReactNode; acoes?: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 p-4 dark:border-slate-800">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="font-display text-sm tracking-tight">{titulo}</h3>
        {acoes}
      </div>
      {children}
    </section>
  );
}

/**
 * Revisão do rascunho (RevisaoRelatorio.jsx do Bate Lastro): os números congelados do snapshot
 * e os textos do questionário, antes de emitir o .docx.
 */
export function RevisaoRelatorio({ inicial, onAtualizado, onAvisar }: {
  inicial: Rascunho;
  onAtualizado: () => void;
  onAvisar: (tipo: 'ok' | 'erro', texto: string) => void;
}) {
  const [r, setR] = useState(inicial);
  const [escolhas, setEscolhas] = useState(inicial.escolhas);
  const [overrides, setOverrides] = useState(inicial.overrides);
  const [tipos, setTipos] = useState<TipoRelatorio[]>(['CVM', 'NIX']);
  const [semPendencias, setSemPendencias] = useState(false);
  const [confirmarSemBase, setConfirmarSemBase] = useState(false);
  const [ocupado, setOcupado] = useState<null | 'salvar' | 'emitir' | 'atualizar' | 'adm'>(null);
  const [emitidos, setEmitidos] = useState<Emitido[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const s = r.snapshot;
  const adm = s.administrador;
  const [dadosAdm, setDadosAdm] = useState({ razao_social: adm.razao_social ?? '', endereco: adm.endereco ?? '', endereco_complemento: adm.endereco_complemento ?? '' });
  const alterado = JSON.stringify(escolhas) !== JSON.stringify(r.escolhas) || JSON.stringify(overrides) !== JSON.stringify(r.overrides);
  const pedeConfirmacao = s.sem_base && r.cenario === 'SEM_MOVIMENTACAO';

  const salvar = async () => {
    setOcupado('salvar');
    try {
      const novo = await relatoriosApi.salvar(r.id, escolhas, overrides);
      setR(novo); setEscolhas(novo.escolhas); setOverrides(novo.overrides);
      return novo;
    } finally {
      setOcupado(null);
    }
  };

  const emitir = async () => {
    setErro(null);
    try {
      if (alterado) await salvar();
      setOcupado('emitir');
      const res = await relatoriosApi.emitir(r.id, tipos, { sem_pendencias: semPendencias, confirmar_sem_base: confirmarSemBase });
      setEmitidos(res.emitidos);
      onAvisar('ok', `${res.emitidos.length} relatório(s) emitido(s). Baixe abaixo.`);
      onAtualizado();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível emitir.');
    } finally {
      setOcupado(null);
    }
  };

  const atualizar = async () => {
    setOcupado('atualizar');
    setErro(null);
    try {
      const novo = await relatoriosApi.preparar(r.fundo_id, r.data_base, s.amostra_antecipada, true);
      setR(novo); setEscolhas(novo.escolhas); setOverrides(novo.overrides);
      onAvisar('ok', 'Rascunho refeito com a carteira e a base de agora. Os textos revisados foram mantidos.');
      onAtualizado();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível atualizar.');
    } finally {
      setOcupado(null);
    }
  };

  const salvarAdm = async () => {
    if (!adm.id) return;
    setOcupado('adm');
    try {
      await relatoriosApi.salvarAdministradora(adm.id, dadosAdm);
      onAvisar('ok', 'Dados da administradora salvos. Eles entram na próxima emissão.');
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível salvar a administradora.');
    } finally {
      setOcupado(null);
    }
  };

  const cen = ROTULO_CENARIO[r.cenario];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Etiqueta cor={cen?.cor ?? 'slate'} titulo={cen?.dica}>{cen?.texto ?? r.cenario}</Etiqueta>
        <span className="text-slate-600 dark:text-slate-400">{s.trimestre} · data-base {s.data_base.split('-').reverse().join('/')}{s.amostra_antecipada ? ' (amostra antecipada)' : ''}</span>
        <span className="text-slate-500">· revisão {r.revisao}</span>
        {s.base_nome ? <span className="text-slate-500">· base “{s.base_nome}”</span> : <Etiqueta cor="amber">sem base no trimestre</Etiqueta>}
        <Botao tamanho="sm" variante="fantasma" className="ml-auto" disabled={Boolean(ocupado)} onClick={atualizar} title="Coleta a carteira de novo e refaz os números com a base atual (os textos ficam)">
          {ocupado === 'atualizar' ? <Loader2 className="size-3.5 animate-spin" /> : <RefreshCw className="size-3.5" />} Atualizar dados
        </Botao>
      </div>

      {!s.carteira.disponivel && <Aviso tipo="alerta">Não há carteira do informe mensal da CVM para este fundo na data-base. Confira o CNPJ do fundo ou atualize a coleta antes de emitir.</Aviso>}
      {pedeConfirmacao && <Aviso tipo="alerta">O fundo tem direitos creditórios, mas nenhuma base de auditoria foi enviada no trimestre. Envie a base (Upload Base) ou confirme abaixo a emissão como sem movimentação.</Aviso>}

      <div className="grid gap-4 lg:grid-cols-2">
        <Bloco titulo="Composição da carteira" acoes={s.carteira.disponivel && (s.carteira.conciliacao.status === 'OK'
          ? <Etiqueta cor="emerald"><CheckCircle2 className="size-3" /> Fecha com o PL</Etiqueta>
          : <Etiqueta cor="orange" titulo={`Diferença de ${moeda(s.carteira.conciliacao.diferenca)}`}><AlertTriangle className="size-3" /> A carteira não fecha com o PL do informe.</Etiqueta>)}>
          {s.carteira.disponivel ? (
            <table className="w-full text-sm">
              <tbody>
                {s.carteira.linhas.map((l) => (
                  <tr key={l.descricao} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1 pr-2">{l.descricao}</td>
                    <td className={cx('py-1 text-right tabular-nums', l.valor < 0 && 'text-rose-600')}>{contabil(l.valor)}</td>
                    <td className="w-20 py-1 text-right tabular-nums text-slate-500">{pct(l.percentual_pl)}</td>
                  </tr>
                ))}
                <tr className="font-semibold"><td className="py-1.5">Patrimônio líquido</td><td className="py-1.5 text-right tabular-nums">{moeda(s.carteira.patrimonio_liquido)}</td><td className="text-right text-slate-500">100,00%</td></tr>
              </tbody>
            </table>
          ) : <p className="font-serif text-sm text-slate-500">Não há carteira do informe mensal da CVM para este fundo na data-base.</p>}
        </Bloco>

        <Bloco titulo="Amostra">
          {s.sem_base ? <p className="font-serif text-sm text-slate-500">O fundo tem direitos creditórios, mas nenhuma base de auditoria foi enviada.</p> : (
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-1">Tipo</th><th className="pb-1 text-right">Qtd.</th><th className="pb-1 text-right">Valor</th><th className="pb-1 text-right">% PL</th></tr></thead>
              <tbody>
                {s.amostra.itens.map((i) => (
                  <tr key={i.descricao} className="border-b border-slate-100 dark:border-slate-800"><td className="py-1">{i.descricao}</td><td className="py-1 text-right tabular-nums">{i.quantidade}</td><td className="py-1 text-right tabular-nums">{contabil(i.valor)}</td><td className="py-1 text-right tabular-nums text-slate-500">{pct(i.percentual_pl)}</td></tr>
                ))}
                <tr className="font-semibold"><td className="py-1.5">Total</td><td className="text-right tabular-nums">{s.amostra.total_quantidade}</td><td className="text-right tabular-nums">{contabil(s.amostra.total_valor)}</td><td className="text-right tabular-nums text-slate-500">{pct(s.amostra.percentual_pl)}</td></tr>
              </tbody>
            </table>
          )}
        </Bloco>

        <Bloco titulo="Verificação de lastro">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase text-slate-500"><tr><th className="pb-1">Frente</th><th className="pb-1 text-right">Total</th><th className="pb-1 text-right">Verificados</th><th className="pb-1 text-right">Pendentes</th></tr></thead>
            <tbody>
              {(['lastro', 'termo'] as const).map((f) => {
                const v = s.verificacao[f];
                return (
                  <tr key={f} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1">{f === 'lastro' ? 'Lastros' : 'Termos de cessão'}</td>
                    <td className="py-1 text-right tabular-nums">{v.total}</td>
                    <td className="py-1 text-right tabular-nums text-emerald-700 dark:text-emerald-400">{v.verificados} <span className="text-xs text-slate-500">({pct(v.percentual_verificado)})</span></td>
                    <td className={cx('py-1 text-right tabular-nums', v.pendentes ? 'text-rose-700 dark:text-rose-400' : '')}>{v.pendentes}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-slate-500">Vem dos vínculos feitos no Bater PDF e na Gestão de Bates (e do que veio batido do Bate Lastro). O Anexo I do NIX traz linha a linha.</p>
        </Bloco>

        <Bloco titulo="Divergências e BlackList">
          <div className="grid grid-cols-2 gap-3 text-sm">
            {(['termo', 'lastro'] as const).map((f) => (
              <div key={f}>
                <p className="lastro-rotulo mb-1 text-slate-500">{f === 'termo' ? 'Termo' : 'Lastro'}</p>
                {s.divergencias[f].map((d) => <p key={d.campo} className="flex justify-between"><span>{d.campo.replace(/:$/, '')}</span><span className={cx('tabular-nums', d.quantidade ? 'font-semibold text-amber-700 dark:text-amber-400' : 'text-slate-400')}>{d.quantidade}</span></p>)}
              </div>
            ))}
          </div>
          <p className={cx('mt-3 rounded-xl px-3 py-2 text-sm', s.blacklist.total_ocorrencias ? 'bg-rose-50 text-rose-900 dark:bg-rose-500/10 dark:text-rose-200' : 'bg-slate-50 text-slate-700 dark:bg-slate-900 dark:text-slate-300')}>{s.blacklist.texto}</p>
        </Bloco>
      </div>

      {adm.id ? (!adm.razao_social || !adm.endereco) && (
        <Bloco titulo={`Administradora: ${adm.nome}`} acoes={<Botao tamanho="sm" disabled={ocupado === 'adm'} onClick={salvarAdm}><Save className="size-3.5" /> Salvar</Botao>}>
          <p className="mb-2 text-xs text-slate-500">O relatório imprime a razão social e o endereço da administradora. Preencha uma vez; vale para todos os fundos dela.</p>
          <div className="grid gap-2 md:grid-cols-3">
            <input className="lastro-campo h-9 px-3 text-sm" placeholder="Razão social" value={dadosAdm.razao_social} onChange={(e) => setDadosAdm({ ...dadosAdm, razao_social: e.target.value })} />
            <input className="lastro-campo h-9 px-3 text-sm" placeholder="Endereço" value={dadosAdm.endereco} onChange={(e) => setDadosAdm({ ...dadosAdm, endereco: e.target.value })} />
            <input className="lastro-campo h-9 px-3 text-sm" placeholder="Complemento (cidade, CEP…)" value={dadosAdm.endereco_complemento} onChange={(e) => setDadosAdm({ ...dadosAdm, endereco_complemento: e.target.value })} />
          </div>
        </Bloco>
      ) : <Aviso tipo="info">O fundo está sem administradora no cadastro: o relatório sai sem razão social e endereço. Cadastre em Gestão › Fundos.</Aviso>}

      <Bloco titulo="Textos do relatório" acoes={alterado && <Botao tamanho="sm" disabled={ocupado === 'salvar'} onClick={() => void salvar()}>{ocupado === 'salvar' ? <Loader2 className="size-3.5 animate-spin" /> : <Save className="size-3.5" />} Salvar textos</Botao>}>
        <p className="mb-3 text-xs text-slate-500">Questionário do relatório CVM ({s.roteiro_cvm === 'numerado' ? 'roteiro numerado 1–16' : 'roteiro I–V'}). Escolha a redação de cada item ou escreva a sua; o texto próprio vale no lugar da opção.</p>
        <div className="space-y-3">
          {r.secoes.map((sec) => {
            const escolhido = escolhas[sec.chave] ?? sec.opcoes[0]?.valor;
            const texto = sec.opcoes.find((o) => o.valor === escolhido)?.texto ?? '';
            const proprio = overrides[sec.chave] ?? '';
            return (
              <details key={sec.chave} className="group rounded-xl border border-slate-200 dark:border-slate-800" open={Boolean(proprio) || escolhido === 'com_ocorrencia'}>
                <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
                  <span className="font-semibold">{sec.titulo}</span>
                  {sec.tipo === 'variante' && <Etiqueta cor={escolhido === 'com_ocorrencia' ? 'amber' : 'slate'}>{escolhido === 'com_ocorrencia' ? 'com ocorrência' : 'sem ocorrência'}</Etiqueta>}
                  {proprio && <Etiqueta cor="violet">texto próprio</Etiqueta>}
                </summary>
                <div className="space-y-2 border-t border-slate-200 px-3 py-2 dark:border-slate-800">
                  {sec.tipo === 'variante' && (
                    <div className="flex gap-2">
                      {sec.opcoes.map((o) => (
                        <button key={o.valor} type="button" onClick={() => setEscolhas({ ...escolhas, [sec.chave]: o.valor })}
                          className={cx('rounded-lg px-3 py-1 text-xs font-semibold', escolhido === o.valor ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-white/10 dark:text-slate-300')}>
                          {o.valor === 'com_ocorrencia' ? 'Com ocorrência' : 'Sem ocorrência'}
                        </button>
                      ))}
                    </div>
                  )}
                  <p className={cx('whitespace-pre-line font-serif text-sm text-slate-700 dark:text-slate-300', proprio && 'line-through opacity-50')}>{texto}</p>
                  <textarea className="lastro-campo min-h-[70px] w-full resize-y px-3 py-2 text-sm" placeholder="Texto próprio (opcional): substitui a redação acima" value={proprio}
                    onChange={(e) => setOverrides({ ...overrides, [sec.chave]: e.target.value })} />
                </div>
              </details>
            );
          })}
        </div>
      </Bloco>

      <div className="sticky bottom-0 -mx-1 space-y-3 rounded-2xl border border-slate-200 bg-[var(--lastro-cartao)] p-4 shadow-lg dark:border-slate-800">
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="flex flex-wrap items-center gap-4 text-sm">
          {(['CVM', 'NIX'] as const).map((t) => (
            <label key={t} className="flex items-center gap-1.5 font-semibold">
              <input type="checkbox" checked={tipos.includes(t)} onChange={(e) => setTipos(e.target.checked ? [...tipos, t] : tipos.filter((x) => x !== t))} /> {t}
            </label>
          ))}
          <label className="flex items-center gap-1.5" title="O CVM sai como se a base estivesse 100% verificada (pendentes contam como verificados). Divergências continuam. O NIX sai sempre com todas.">
            <input type="checkbox" checked={semPendencias} onChange={(e) => setSemPendencias(e.target.checked)} /> CVM sem pendências
          </label>
          {pedeConfirmacao && (
            <label className="flex items-center gap-1.5 text-amber-800 dark:text-amber-300">
              <input type="checkbox" checked={confirmarSemBase} onChange={(e) => setConfirmarSemBase(e.target.checked)} /> Emitir como sem movimentação
            </label>
          )}
          <Botao variante="primario" className="ml-auto" disabled={!tipos.length || Boolean(ocupado) || !s.carteira.disponivel || (pedeConfirmacao && !confirmarSemBase)} onClick={emitir}>
            {ocupado === 'emitir' ? <Loader2 className="size-4 animate-spin" /> : <FileText className="size-4" />} Emitir {tipos.join(' e ') || '…'}
          </Botao>
        </div>
        {(emitidos.length > 0 || r.emissoes.length > 0) && (
          <div className="flex flex-wrap gap-2">
            {(emitidos.length ? emitidos.map((e) => ({ id: e.id, tipo: e.tipo, nome_arquivo: e.nome_arquivo })) : r.emissoes.slice(0, 4)).map((e) => (
              <a key={e.id} href={relatoriosApi.urlEmissao(e.id)} className="lastro-botao lastro-botao-sm lastro-botao-secundario" download>
                <Download className="size-3.5" /> {e.nome_arquivo}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
