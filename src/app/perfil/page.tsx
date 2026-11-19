import { AlternarTema } from '@/components/AlternarTema';
import { Pagina, Secao } from '@/components/Pagina';
import { Etiqueta } from '@/components/ui';
import { db, pastaDeDados } from '@/lib/db';
import { MODELO_PADRAO, statusGemini } from '@/lib/ia/config';

export const dynamic = 'force-dynamic';

const codigo = 'rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm dark:border-slate-800 dark:bg-slate-900';

export default function Perfil() {
  const ia = statusGemini();
  const uso = db().prepare(`SELECT COUNT(*) chamadas, COALESCE(SUM(tokens_entrada), 0) entrada, COALESCE(SUM(tokens_saida), 0) saida,
    COALESCE(SUM(custo_usd), 0) custo FROM uso_ia`).get() as { chamadas: number; entrada: number; saida: number; custo: number };
  return (
    <Pagina titulo="Perfil" subtitulo="Preferências deste computador. A versão local não tem login: quem usa é quem está na máquina." largura="max-w-3xl">
      <div className="space-y-6">
        <Secao titulo="Preferências" descricao="Valem só neste computador e neste navegador.">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold">Modo escuro</p>
              <p className="text-sm text-slate-600 dark:text-slate-400">O padrão é o fundo branco.</p>
            </div>
            <AlternarTema />
          </div>
        </Secao>

        <Secao
          titulo="Leitura por IA (Gemini)"
          descricao="No Anexo, cada PDF é classificado e lido pelo Google Gemini, como no Bate Lastro. Precisa de internet e de uma chave da API; cada leitura é cobrada pelo Google."
          acoes={ia.configurada ? <Etiqueta cor="emerald">Chave configurada</Etiqueta> : <Etiqueta cor="rose">Chave não configurada</Etiqueta>}
        >
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="lastro-rotulo text-slate-500 dark:text-slate-400">Modelo</dt>
              <dd className="mt-0.5 font-mono">{ia.modelo}{ia.modelo !== MODELO_PADRAO && <span className="ml-1 font-sans text-xs text-slate-500">(padrão: {MODELO_PADRAO})</span>}</dd>
            </div>
            <div>
              <dt className="lastro-rotulo text-slate-500 dark:text-slate-400">Limite por PDF</dt>
              <dd className="mt-0.5">{ia.max_paginas} páginas</dd>
            </div>
            <div>
              <dt className="lastro-rotulo text-slate-500 dark:text-slate-400">Uso registrado</dt>
              <dd className="mt-0.5">
                {uso.chamadas.toLocaleString('pt-BR')} etapa(s) · {(uso.entrada + uso.saida).toLocaleString('pt-BR')} tokens
                {ia.preco_conhecido && <> · US$ {uso.custo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</>}
              </dd>
            </div>
          </dl>
          <div className="mt-4 space-y-2 text-sm text-slate-700 dark:text-slate-300">
            <p className="font-serif">
              {ia.configurada
                ? 'Para trocar a chave ou o modelo, edite o arquivo abaixo e reinicie o app.'
                : 'Sem a chave, os PDFs enviados no Anexo terminam com erro (“Configure a chave do Gemini”) e podem ser lidos depois com “Tentar de novo”. XML de NF-e é lido mesmo sem a chave.'}
            </p>
            <p>
              Crie (ou edite) o arquivo <code className="font-mono">.env.local</code> na pasta do app, com o abaixo. Os nomes do
              .env do Bate Lastro também valem (<code className="font-mono">GOOGLE_API_KEY</code>, <code className="font-mono">DEFAULT_READING_MODEL</code>).
            </p>
            <pre className={`${codigo} whitespace-pre-wrap`}>{`GEMINI_API_KEY=cole-aqui-a-sua-chave\n# opcional (padrão ${MODELO_PADRAO}):\nGEMINI_MODELO=${MODELO_PADRAO}`}</pre>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Depois, pare e inicie o app de novo. O <code className="font-mono">.env.local</code> não vai para o Git, e a chave nunca aparece na tela nem no log.
            </p>
          </div>
        </Secao>

        <Secao titulo="Dados" descricao="Banco, PDFs e arquivos gerados ficam nesta pasta. Para mudar, defina BATE_PDF_DADOS antes de iniciar o app.">
          <code className={`block break-all ${codigo}`}>{pastaDeDados()}</code>
        </Secao>
      </div>
    </Pagina>
  );
}
