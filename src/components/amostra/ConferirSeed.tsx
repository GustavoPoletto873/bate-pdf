'use client';

import { useRef, useState } from 'react';
import { CheckCircle2, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { Aviso, Botao, cx } from '@/components/ui';
import { formatarMoeda } from '@/lib/valores';
import { ErroApi } from '@/lib/cliente';
import { amostraApi, type Conferencia, type DetalheAmostragem } from '@/lib/cliente/amostra';
import { normalizarSeedOuNull } from '@/lib/amostra/seed';
import { juntar, separar } from '@/lib/amostra/arquivos';
import { Bloco, Campo, Contagem, DICA, LinhaArquivo, Opcoes, ZonaArquivos, dataBr, inteiro } from './comum';

const LIMITE_TABELA = 50;
type Busca = { estado: 'vazia' | 'buscando' | 'desconhecida' } | { estado: 'registrada'; amostra: DetalheAmostragem } | { estado: 'erro'; mensagem: string };

/**
 * Aba "Conferir seed" (ConferirSeed.jsx do Bate Lastro): refaz o sorteio com o estoque enviado e diz
 * se é a amostra registrada. Não grava nada e não oferece planilha.
 */
export function ConferirSeed() {
  const [texto, setTexto] = useState('');
  const [busca, setBusca] = useState<Busca>({ estado: 'vazia' });
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [dataDe, setDataDe] = useState('');
  const [dataAte, setDataAte] = useState('');
  const [limiteAdquiridos, setLimiteAdquiridos] = useState(120);
  const [limiteVencidos, setLimiteVencidos] = useState(120);
  const [regra, setRegra] = useState<'padrao' | 'planner'>('padrao');
  const [conferindo, setConferindo] = useState(false);
  const [resultado, setResultado] = useState<Conferencia | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const versao = useRef(0);

  const seed = normalizarSeedOuNull(texto);
  const { estoques, liquidados } = separar(arquivos);
  // Qualquer mudança invalida o resultado na tela e as respostas ainda a caminho.
  const mudou = () => {
    versao.current++;
    setResultado(null);
  };

  const digitar = async (valor: string) => {
    setTexto(valor);
    mudou();
    const s = normalizarSeedOuNull(valor);
    if (!s) {
      setBusca({ estado: 'vazia' });
      return;
    }
    if (s === seed) return;
    const pedido = versao.current;
    setBusca({ estado: 'buscando' });
    try {
      const amostra = await amostraApi.buscarPorSeed(s);
      if (pedido === versao.current) setBusca({ estado: 'registrada', amostra });
    } catch (e) {
      if (pedido !== versao.current) return;
      if (e instanceof ErroApi && e.status === 404) setBusca({ estado: 'desconhecida' });
      else setBusca({ estado: 'erro', mensagem: e instanceof ErroApi ? e.message : 'Não foi possível procurar a seed.' });
    }
  };

  const desconhecida = busca.estado === 'desconhecida';
  const falta = [
    !seed && 'digitar a seed (12 caracteres)',
    !estoques.length && 'enviar o estoque',
    desconhecida && (!dataDe || !dataAte) && 'informar o período',
  ].filter(Boolean) as string[];
  const pronto = !falta.length && (busca.estado === 'registrada' || desconhecida);

  const conferir = async () => {
    if (!seed) return;
    const pedido = versao.current;
    setConferindo(true);
    setResultado(null);
    setErro(null);
    try {
      const r = await amostraApi.conferir({
        seed, estoques, liquidados, ...(desconhecida ? { dataDe, dataAte, limiteAdquiridos, limiteVencidos, regra } : {}),
      });
      if (pedido === versao.current) setResultado(r);
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível conferir a seed. Tente de novo.');
    } finally {
      setConferindo(false);
    }
  };

  const numero = (t: string) => Math.max(0, parseInt(t, 10) || 0);

  return (
    <section className="lastro-cartao space-y-6 p-6">
      <Bloco titulo="Conferir seed">
        <p className={DICA}>Digite a seed de uma amostra e anexe o estoque: o Lastro refaz o sorteio e diz se a amostra confere. Nada é registrado.</p>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <div className="space-y-2">
            <Campo rotulo="Seed" id="conf-seed">
              <input id="conf-seed" value={texto} onChange={(e) => void digitar(e.target.value)} maxLength={16} placeholder="XXXX-XXXX-XXXX" autoComplete="off" spellCheck={false}
                className="lastro-campo h-10 w-full px-3 font-mono uppercase tracking-widest" />
            </Campo>
            <div className={DICA} aria-live="polite">
              {busca.estado === 'buscando' && <p className="flex items-center gap-1.5"><Loader2 className="size-3.5 animate-spin" /> Procurando a seed…</p>}
              {busca.estado === 'registrada' && (
                <p>
                  Seed da amostra de <strong className="text-slate-800 dark:text-slate-100">{busca.amostra.fundo}</strong>
                  {' · '}{dataBr(busca.amostra.data_de)} a {dataBr(busca.amostra.data_ate)}
                  {' · '}gerada em {dataBr(busca.amostra.criado_em)}
                  {' · '}{busca.amostra.status === 'GERADA' ? 'valendo' : 'descartada'}
                </p>
              )}
              {desconhecida && <p>Seed não encontrada no Lastro. Informe período e limites para ver a amostra que ela gera.</p>}
              {busca.estado === 'erro' && <p className="text-rose-600 dark:text-rose-400">{busca.mensagem}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">Estoque</p>
            <ZonaArquivos titulo="Estoque e liquidados usados na amostra" multiplo onArquivos={(n) => { mudou(); setArquivos(juntar(arquivos, n)); }} />
            {([['Estoque', estoques], ['Liquidados', liquidados]] as const).map(([rotulo, lista]) => lista.length > 0 && (
              <div key={rotulo} className="space-y-2">
                {liquidados.length > 0 && <p className={DICA}>{rotulo}</p>}
                {lista.map((a) => <LinhaArquivo key={`${a.name}-${a.size}`} arquivo={a} onRemover={() => { mudou(); setArquivos(arquivos.filter((x) => x !== a)); }} />)}
              </div>
            ))}
            <p className={DICA}>O conteúdo do arquivo é conferido, não o nome. Se a amostra usou liquidados, envie-os também.</p>
          </div>
        </div>

        {desconhecida && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Campo rotulo="Data de início" id="conf-de"><input id="conf-de" type="date" value={dataDe} onChange={(e) => { mudou(); setDataDe(e.target.value); }} className="lastro-campo h-10 w-full px-3 text-sm" /></Campo>
              <Campo rotulo="Data fim" id="conf-ate"><input id="conf-ate" type="date" value={dataAte} onChange={(e) => { mudou(); setDataAte(e.target.value); }} className="lastro-campo h-10 w-full px-3 text-sm" /></Campo>
              <Campo rotulo="Limite de adquiridos" id="conf-adq"><input id="conf-adq" type="number" min={0} value={limiteAdquiridos} onChange={(e) => { mudou(); setLimiteAdquiridos(numero(e.target.value)); }} className="lastro-campo h-10 w-full px-3 text-sm" /></Campo>
              <Campo rotulo="Limite de vencidos" id="conf-venc"><input id="conf-venc" type="number" min={0} value={limiteVencidos} onChange={(e) => { mudou(); setLimiteVencidos(numero(e.target.value)); }} className="lastro-campo h-10 w-full px-3 text-sm" /></Campo>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="lastro-rotulo">Regra</span>
              <Opcoes rotulo="Regra da conferência" valor={regra} onChange={(v) => { mudou(); setRegra(v); }} opcoes={[{ valor: 'padrao', rotulo: 'Padrão' }, { valor: 'planner', rotulo: 'Planner' }]} />
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3 border-t border-dashed border-slate-300 pt-5 md:flex-row md:items-center md:justify-between dark:border-slate-700">
          <p className="text-sm text-slate-600 dark:text-slate-400" aria-live="polite">
            {falta.length ? `Falta ${falta[0]}.` : busca.estado === 'registrada' ? 'O sorteio vai usar os parâmetros registrados com esta seed.' : ''}
          </p>
          <Botao variante="primario" onClick={conferir} disabled={!pronto || conferindo}>
            {conferindo ? <Loader2 className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />} {conferindo ? 'Conferindo…' : 'Conferir'}
          </Botao>
        </div>
      </Bloco>

      {erro && <Aviso tipo="erro">{erro}</Aviso>}
      {resultado && (
        <div className="space-y-4">
          {resultado.confere === true && (
            <Aviso tipo="ok"><span className="flex items-start gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0" /><span><strong>Confere.</strong> Com esta seed e este estoque, o sorteio dá exatamente a amostra registrada ({inteiro(resultado.titulos.length)} títulos, mesma ordem).</span></span></Aviso>
          )}
          {resultado.confere === false && (
            <Aviso tipo="erro">
              <p className="flex items-center gap-2 font-semibold"><XCircle className="size-4" /> Não confere com a amostra registrada.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-8">{resultado.divergencias.map((d) => <li key={d}>{d}</li>)}</ul>
            </Aviso>
          )}
          {resultado.confere === null && (
            <Aviso tipo="info">Amostra que esta seed gera com este estoque: <strong>{inteiro(resultado.titulos.length)} títulos</strong> · <Contagem contagem={resultado.contagem} />. Ela não é uma amostra registrada no Lastro.</Aviso>
          )}
          {resultado.titulos.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-left dark:border-slate-700">
                    {['Grupo', 'Cedente', 'Documento', 'Seu número', 'Valor presente'].map((h) => <th key={h} className={cx('lastro-rotulo px-4 py-2.5 text-slate-500 dark:text-slate-400', h === 'Valor presente' && 'text-right')}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {resultado.titulos.slice(0, LIMITE_TABELA).map((t, i) => (
                    <tr key={`${t.doc_cedente}|${t.nu_documento}|${t.seu_numero}|${i}`} className="border-b border-slate-100 dark:border-slate-800">
                      <td className="px-4 py-2 text-slate-600 dark:text-slate-400">{t.grupo}</td>
                      <td className="px-4 py-2">{t.cedente}</td>
                      <td className="px-4 py-2 font-mono">{t.nu_documento}</td>
                      <td className="px-4 py-2 font-mono">{t.seu_numero}</td>
                      <td className="px-4 py-2 text-right tabular-nums">{formatarMoeda(t.valor_presente)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {resultado.titulos.length > LIMITE_TABELA && <p className={cx(DICA, 'px-4 py-2')}>Mostrando {LIMITE_TABELA} de {inteiro(resultado.titulos.length)} títulos.</p>}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
