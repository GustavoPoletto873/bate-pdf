'use client';

import { useState } from 'react';
import { Download, FileJson } from 'lucide-react';
import { api, ErroApi } from '@/lib/cliente';
import type { BaseResumo } from '@/lib/repo';
import { Aviso, Botao, Dialogo } from '@/components/ui';
import { formatarCpfCnpj } from '@/lib/texto';

export function DialogoExportar({ aberto, base, preBates = 0, onFechar, onSalvo }: { aberto: boolean; base: BaseResumo; preBates?: number; onFechar: () => void; onSalvo: () => void }) {
  const [incluirPendentes, setIncluirPendentes] = useState(false);
  const [cnpj, setCnpj] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const batidos = base.vinculados.termo + base.vinculados.lastro;

  const salvarCnpj = async () => {
    try {
      await api.atualizarBase(base.id, { cnpj_fundo: cnpj });
      setErro(null);
      onSalvo();
    } catch (e) {
      setErro(e instanceof ErroApi ? e.message : 'Não foi possível salvar o CNPJ.');
    }
  };

  return (
    <Dialogo aberto={aberto} titulo="Exportar para o Bate Lastro" onFechar={onFechar} largura="max-w-xl">
      <div className="space-y-3 text-sm">
        <p>
          Gera o <b>resultados_matching_{base.cnpj_fundo ?? '<CNPJ>'}_….xlsx</b> no formato que o Bate Lastro lê em
          <b> Gestão de Bates → Inserir Resultado</b>. Lá aparece uma prévia antes de gravar.
        </p>
        <ul className="list-disc space-y-1 pl-5 text-slate-600 dark:text-slate-400">
          <li><b>{batidos}</b> pendência(s) batida(s) aqui vão com <b>STATUS V</b>, as marcações V/D/P (DIV_*) e o que o documento traz (LEITURA_*).</li>
          {preBates > 0 && <li><b>{preBates}</b> pré-bate(s) ainda não confirmado(s) também vão com STATUS V (como no Bate Lastro). Confirme ou rejeite na Gestão de Bates antes, se não quiser levá-los.</li>}
          <li>{base.origem === 'resultados_matching'
            ? 'A base veio do resultados_matching do Bate Lastro: cada título vai com o seu ID_BASE.'
            : 'A base veio da amostra: o Bate Lastro acha cada título pelo nº do documento + valor (precisa ser único na base de lá).'}</li>
          <li>O vínculo entra lá como leitura de planilha (sem o PDF anexado); o nome do PDF e a página vão nas colunas PDF_ARQUIVO/PDF_PAGINA, para conferência.</li>
          <li>Não renomeie o arquivo: o CNPJ do fundo vai no nome.</li>
        </ul>
        {!base.cnpj_fundo && (
          <Aviso tipo="alerta">
            Falta o CNPJ do fundo: sem ele o Inserir Resultado recusa a planilha.
            <div className="mt-2 flex gap-2">
              <input className="lastro-campo h-8 flex-1 px-3 font-mono text-sm" placeholder="00.000.000/0000-00" value={cnpj} onChange={(e) => setCnpj(e.target.value)} />
              <Botao tamanho="sm" onClick={salvarCnpj}>Salvar</Botao>
            </div>
          </Aviso>
        )}
        {base.cnpj_fundo && <p className="text-xs text-slate-500">CNPJ do fundo: {formatarCpfCnpj(base.cnpj_fundo)}</p>}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={incluirPendentes} onChange={(e) => setIncluirPendentes(e.target.checked)} />
          Incluir também as pendentes (STATUS P — o Bate Lastro ignora, servem para revisão na planilha)
        </label>
        {erro && <Aviso tipo="erro">{erro}</Aviso>}
        <div className="flex flex-wrap gap-2 pt-1">
          <a href={`/api/bases/${base.id}/exportar?formato=xlsx&pendentes=${incluirPendentes ? '1' : '0'}`} download>
            <Botao variante="primario" disabled={!base.cnpj_fundo}><Download className="size-4" /> Baixar resultados_matching (.xlsx)</Botao>
          </a>
          <a href={`/api/bases/${base.id}/exportar?formato=json`} download>
            <Botao><FileJson className="size-4" /> Backup completo (.json)</Botao>
          </a>
        </div>
        <p className="text-xs text-slate-500">
          O backup .json guarda tudo desta base (títulos, marcações, vínculos com o PDF e a página) — útil para arquivar a contingência
          ou para uma importação completa no Bate Lastro no futuro.
        </p>
      </div>
    </Dialogo>
  );
}
