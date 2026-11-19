'use client';

import { useRef, useState } from 'react';
import { Download, FileSpreadsheet, HelpCircle, Search, Upload, X } from 'lucide-react';
import type { ResultadoImportacaoFundos } from '@/lib/fundos';
import { apiFundos } from '@/lib/cliente/fundos';
import { Secao } from '@/components/Pagina';
import { Aviso, Botao, Dialogo, Etiqueta, cx } from '@/components/ui';
import { mensagemDeErro, rotuloTipo } from './util';

const ROTULO_CAMPO = { administradora: 'Administradora', gestor: 'Gestor' } as const;

/** Prévia ou resultado da importação, agrupado como no Bate Lastro. */
function ResumoImportacao({ resultado, onFechar }: { resultado: ResultadoImportacaoFundos; onFechar?: () => void }) {
  const { simulacao, inseridos, atualizados, duplicados, invalidos } = resultado;
  const linha = (i: { linha: number; nome: string | null; cnpj: string | null }) => `Linha ${i.linha} · ${i.nome || 'Sem nome'} (${i.cnpj || 'sem CNPJ'})`;
  const grupos = [
    { titulo: 'Inválidos', cor: 'rose' as const, aberto: true, itens: invalidos.map((i) => `${linha(i)}: ${i.motivo}`) },
    { titulo: simulacao ? 'Serão alterados' : 'Alterados', cor: 'violet' as const, itens: atualizados.map((i) => `${linha(i)}: ${i.alteracoes.map((a) => `${ROTULO_CAMPO[a.campo]} ${a.de} → ${a.para}`).join('; ')}`) },
    { titulo: simulacao ? 'Serão cadastrados' : 'Cadastrados', cor: 'emerald' as const, itens: inseridos.map((i) => `${linha(i)}: ${rotuloTipo(i.tipo)}, administradora ${i.administradora}, gestor ${i.gestor || 'Não informado'}`) },
    { titulo: 'Já cadastrados, sem alteração', cor: 'slate' as const, itens: duplicados.map(linha) },
  ];
  return (
    <div role="status" className="relative rounded-xl border-2 border-dashed border-slate-300 p-4 text-sm dark:border-slate-700">
      {onFechar && (
        <button type="button" onClick={onFechar} aria-label="Fechar resultado da importação" className="absolute right-3 top-3 rounded-full p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:hover:bg-slate-800 dark:hover:text-slate-100">
          <X className="size-4" />
        </button>
      )}
      <p className="pr-8 font-semibold">{simulacao ? 'Prévia da planilha. Nada foi gravado ainda.' : 'Importação concluída.'}</p>
      <p className="mt-0.5 text-slate-600 dark:text-slate-400">
        {inseridos.length} novo(s), {atualizados.length} com alteração, {duplicados.length} sem alteração e {invalidos.length} inválido(s).
      </p>
      {grupos.filter((g) => g.itens.length).map((g) => (
        <details key={g.titulo} open={g.aberto || g.itens.length <= 5} className="mt-3">
          <summary className="cursor-pointer font-medium">
            <Etiqueta cor={g.cor}>{g.titulo} ({g.itens.length})</Etiqueta>
          </summary>
          <ul className="rolagem-fina mt-1 max-h-60 list-disc space-y-0.5 overflow-y-auto pl-5 text-slate-700 dark:text-slate-300">
            {g.itens.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </details>
      ))}
    </div>
  );
}

/** Como preencher (o ComoPreencherPlanilha do Bate Lastro, sem a animação). */
function ComoPreencher({ aberto, onFechar }: { aberto: boolean; onFechar: () => void }) {
  const casos = [
    { titulo: 'Fundo que ainda não existe', pontos: ['CNPJ e nome são obrigatórios para cadastrar.', 'Em Tipo use FIDC ou FIC FIDC. Em branco, o fundo entra como FIDC.', 'Administradora e gestor são opcionais: dá para preencher agora ou depois.'] },
    { titulo: 'Fundo já cadastrado', pontos: ['O fundo é encontrado pelo CNPJ. Nome e tipo podem ficar em branco e, se preenchidos, são ignorados.', 'Só a administradora e o gestor mudam. Em branco mantém o que já está cadastrado (para apagar o gestor, edite o fundo na lista).', 'Escreva a administradora como ela aparece na aba Administradores do modelo. Maiúsculas e acentos não importam.'] },
    { titulo: 'Vários de uma vez', pontos: ['Uma linha por fundo; dá para misturar fundos novos e alterações.', 'Em "Conferir planilha" aparece a prévia. Nada é gravado até você confirmar.', 'Linhas com erro não são gravadas: corrija na planilha e envie de novo.'] },
  ];
  return (
    <Dialogo aberto={aberto} titulo="Como preencher a planilha de fundos" onFechar={onFechar} largura="max-w-2xl" rodape={<Botao onClick={onFechar}>Entendi</Botao>}>
      <p className="font-serif text-sm text-slate-600 dark:text-slate-400">
        Linha 1 com os nomes das colunas: <b>CNPJ</b>, <b>Nome do fundo</b>, <b>Tipo</b>, <b>Administrador</b> e <b>Gestor</b>. Deixe a coluna do CNPJ como texto
        (no modelo ela já vem assim): como número, o Excel come o zero à esquerda e mostra 1,12E+13.
      </p>
      <div className="mt-4 space-y-4">
        {casos.map((c) => (
          <div key={c.titulo}>
            <h3 className="font-semibold">{c.titulo}</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-700 dark:text-slate-300">
              {c.pontos.map((p) => <li key={p}>{p}</li>)}
            </ul>
          </div>
        ))}
      </div>
    </Dialogo>
  );
}

/** Importação em lote: modelo, conferir (simulação) e confirmar. */
export function ImportacaoFundos({ onImportado }: { onImportado: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const [previa, setPrevia] = useState<ResultadoImportacaoFundos | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacaoFundos | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ajuda, setAjuda] = useState(false);

  function escolher(f: File | undefined) {
    if (!f) return;
    setErro(null);
    setResultado(null);
    setPrevia(null);
    if (/\.xls$/i.test(f.name)) { setErro('Planilha no formato antigo (.xls). Abra no Excel e salve como .xlsx.'); return; }
    if (!/\.(xlsx|csv)$/i.test(f.name)) { setErro('Envie a planilha em Excel (.xlsx) ou CSV.'); return; }
    setArquivo(f);
  }

  async function conferir() {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    try {
      setPrevia(await apiFundos.importar(arquivo, true));
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível ler a planilha. Confira se o arquivo é um .xlsx salvo pelo Excel ou um .csv.'));
    } finally {
      setOcupado(false);
    }
  }

  async function confirmar() {
    if (!arquivo) return;
    setOcupado(true);
    setErro(null);
    try {
      const r = await apiFundos.importar(arquivo, false);
      setPrevia(null);
      setResultado(r);
      setArquivo(null);
      onImportado();
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível importar os fundos. Tente de novo.'));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Secao
      titulo="Importação em lote"
      descricao="Com a mesma planilha você cadastra fundos novos e troca a administradora ou o gestor dos que já existem. Nada é gravado antes de você conferir a prévia."
      acoes={<Botao variante="fantasma" tamanho="sm" onClick={() => setAjuda(true)}><HelpCircle className="size-4" /> Como preencher</Botao>}
    >
      <ComoPreencher aberto={ajuda} onFechar={() => setAjuda(false)} />
      <div
        role="button" tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inputRef.current?.click(); } }}
        onDragOver={(e) => { e.preventDefault(); setArrastando(true); }}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setArrastando(false); }}
        onDrop={(e) => { e.preventDefault(); setArrastando(false); escolher(e.dataTransfer.files[0]); }}
        className={cx('cursor-pointer rounded-2xl border-2 border-dashed px-6 py-8 text-center transition-colors',
          arrastando ? 'border-slate-900 bg-slate-50 dark:border-slate-100 dark:bg-slate-900' : 'border-slate-300 hover:border-slate-500 dark:border-slate-700 dark:hover:border-slate-500')}
      >
        <FileSpreadsheet className="mx-auto size-9 text-slate-400" />
        <p className="mt-2 text-sm font-medium">Arraste a planilha aqui ou clique para escolher (Excel ou CSV)</p>
        {arquivo && <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">Arquivo escolhido: <b>{arquivo.name}</b></p>}
        <input ref={inputRef} type="file" hidden accept=".xlsx,.csv" onChange={(e) => { escolher(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <a href={apiFundos.urlModelo} download className="lastro-botao lastro-botao-md lastro-botao-secundario">
          <Download className="size-4" /> Baixar modelo
        </a>
        {arquivo && !previa && (
          <Botao variante="primario" onClick={conferir} disabled={ocupado}>
            <Search className="size-4" /> {ocupado ? 'Conferindo…' : 'Conferir planilha'}
          </Botao>
        )}
      </div>

      {erro && <div className="mt-4"><Aviso tipo="erro">{erro}</Aviso></div>}

      {previa && (
        <div className="mt-4 space-y-3">
          <ResumoImportacao resultado={previa} />
          <div className="flex flex-wrap gap-2">
            <Botao variante="primario" onClick={confirmar} disabled={ocupado || !(previa.inseridos.length + previa.atualizados.length)}>
              <Upload className="size-4" /> {ocupado ? 'Importando…' : 'Confirmar importação'}
            </Botao>
            <Botao variante="fantasma" onClick={() => setPrevia(null)} disabled={ocupado}><X className="size-4" /> Cancelar</Botao>
          </div>
        </div>
      )}
      {resultado && <div className="mt-4"><ResumoImportacao resultado={resultado} onFechar={() => setResultado(null)} /></div>}
    </Secao>
  );
}
