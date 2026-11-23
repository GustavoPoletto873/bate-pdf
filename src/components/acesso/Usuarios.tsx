'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import { Check, Copy, Link2, Plus, ShieldCheck, Trash2, X } from 'lucide-react';
import { Secao } from '@/components/Pagina';
import { Aviso, Botao, Etiqueta } from '@/components/ui';
import { chamar, json } from '@/lib/cliente';

// Administração das contas (só administradores), como a Área Administrativa do Bate Lastro:
// convidar, gerar link novo (senha + authenticator), perfil, encerrar sessões, desativar.

type Perfil = 'admin' | 'usuario';
type Situacao = 'ativo' | 'convite' | 'convite_vencido' | 'desativado';

interface Conta {
  email: string;
  nome: string;
  perfil: Perfil;
  situacao: Situacao;
  conviteTipo: 'cadastro' | 'redefinir' | null;
  conviteExpira: string | null;
  ultimoAcesso: string | null;
  sessoes: number;
  criadoEm: string;
  criadoPor: string;
}

interface LinkGerado {
  email: string;
  nome: string;
  link: string;
  tipo: 'cadastro' | 'redefinir';
}

const SITUACAO: Record<Situacao, { cor: 'emerald' | 'sky' | 'amber' | 'slate'; rotulo: string }> = {
  ativo: { cor: 'emerald', rotulo: 'Ativa' },
  convite: { cor: 'sky', rotulo: 'Convite enviado' },
  convite_vencido: { cor: 'amber', rotulo: 'Convite vencido' },
  desativado: { cor: 'slate', rotulo: 'Desativada' },
};

const dataHora = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const mensagem = (e: unknown) => (e instanceof Error ? e.message : 'Não deu certo.');

export function Usuarios() {
  const [contas, setContas] = useState<Conta[] | null>(null);
  const [eu, setEu] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [link, setLink] = useState<LinkGerado | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const j = await chamar<{ usuarios: Conta[]; eu: string }>('/api/usuarios');
      setErro(null);
      setContas(j.usuarios);
      setEu(j.eu);
    } catch (e) {
      setErro(mensagem(e));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga inicial da lista
    void carregar();
  }, [carregar]);

  async function agir(c: Conta, acao: string, extra: object = {}, confirmar?: string) {
    if (confirmar && !window.confirm(confirmar)) return;
    setOcupado(c.email);
    setAviso(null);
    try {
      const j = await chamar<{ link: string | null; usuario: Conta }>('/api/usuarios', json({ email: c.email, acao, ...extra }, 'PATCH'));
      if (j.link) setLink({ email: c.email, nome: c.nome, link: j.link, tipo: j.usuario.conviteTipo ?? 'cadastro' });
    } catch (e) {
      setAviso(mensagem(e));
    }
    setOcupado(null);
    await carregar();
  }

  async function excluir(c: Conta) {
    if (!window.confirm(`Excluir a conta de ${c.nome} (${c.email})? Isso não pode ser desfeito.`)) return;
    setOcupado(c.email);
    try {
      await chamar(`/api/usuarios?email=${encodeURIComponent(c.email)}`, { method: 'DELETE' });
    } catch (e) {
      setAviso(mensagem(e));
    }
    setOcupado(null);
    await carregar();
  }

  if (erro) return <Aviso tipo="erro">{erro}</Aviso>;

  return (
    <div className="space-y-6">
      <Convidar
        aoCriar={async (l) => {
          setLink(l);
          await carregar();
        }}
      />

      {link && <LinkPronto link={link} aoFechar={() => setLink(null)} />}

      <Secao titulo="Contas" descricao="Quem pode entrar no Lastro. Toda conta usa senha + authenticator; o link de acesso vale 48 horas e funciona uma vez só.">
        {aviso && <div className="mb-3"><Aviso tipo="erro">{aviso}</Aviso></div>}
        {!contas ? (
          <p className="text-sm text-slate-500" aria-busy="true">Carregando…</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="lastro-rotulo border-b border-dashed border-slate-300 text-left text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Pessoa</th>
                  <th className="py-2 pr-3 font-semibold">Perfil</th>
                  <th className="py-2 pr-3 font-semibold">Situação</th>
                  <th className="py-2 pr-3 font-semibold">Último acesso</th>
                  <th className="py-2 pr-3 text-right font-semibold">Sessões</th>
                  <th className="py-2"><span className="sr-only">Ações</span></th>
                </tr>
              </thead>
              <tbody>
                {contas.map((c) => {
                  const s = SITUACAO[c.situacao];
                  const souEu = c.email === eu;
                  const busy = ocupado === c.email;
                  return (
                    <tr key={c.email} className="border-b border-slate-100 align-top dark:border-slate-800">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold">{c.nome}{souEu && <span className="font-normal text-slate-500"> (você)</span>}</div>
                        <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{c.email}</div>
                      </td>
                      <td className="py-2.5 pr-3">{c.perfil === 'admin' ? 'Administrador' : 'Usuário'}</td>
                      <td className="py-2.5 pr-3">
                        <Etiqueta cor={s.cor}>{s.rotulo}</Etiqueta>
                        {c.conviteTipo === 'redefinir' && c.situacao === 'ativo' && <div className="mt-1 text-xs text-slate-500">link de redefinição enviado</div>}
                        {c.conviteExpira && c.situacao === 'convite' && <div className="mt-1 text-xs text-slate-500">vale até {dataHora(c.conviteExpira)}</div>}
                      </td>
                      <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-400">{c.ultimoAcesso ? dataHora(c.ultimoAcesso) : 'nunca'}</td>
                      <td className="py-2.5 pr-3 text-right tabular-nums">{c.sessoes}</td>
                      <td className="py-2.5">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          {c.situacao !== 'desativado' && (
                            <Botao
                              tamanho="sm"
                              disabled={busy}
                              title={c.situacao === 'ativo' ? 'Link para criar senha e authenticator novos' : 'Gerar um convite novo'}
                              onClick={() => agir(c, 'link', {}, c.situacao === 'ativo'
                                ? `Gerar um link para ${c.nome} criar senha e authenticator novos? O acesso atual continua valendo até o link ser usado.`
                                : undefined)}
                            >
                              <Link2 className="size-3.5" /> {c.situacao === 'ativo' ? 'Redefinir acesso' : 'Novo convite'}
                            </Botao>
                          )}
                          {!souEu && c.situacao !== 'desativado' && (
                            <Botao tamanho="sm" disabled={busy} onClick={() => agir(c, 'perfil', { perfil: c.perfil === 'admin' ? 'usuario' : 'admin' })}>
                              {c.perfil === 'admin' ? 'Tornar usuário' : 'Tornar admin'}
                            </Botao>
                          )}
                          {c.sessoes > 0 && (
                            <Botao tamanho="sm" disabled={busy} onClick={() => agir(c, 'encerrar', {}, `Encerrar as ${c.sessoes} sessões abertas de ${c.nome}? A pessoa precisa entrar de novo.`)}>
                              Encerrar sessões
                            </Botao>
                          )}
                          {!souEu && (c.situacao === 'desativado' ? (
                            <Botao tamanho="sm" disabled={busy} onClick={() => agir(c, 'reativar')}>Reativar</Botao>
                          ) : (
                            <Botao tamanho="sm" variante="perigo" disabled={busy} onClick={() => agir(c, 'desativar', {}, `Desativar a conta de ${c.nome}? O acesso cai em até 30 segundos.`)}>
                              Desativar
                            </Botao>
                          ))}
                          {!souEu && (
                            <Botao tamanho="sm" variante="fantasma" disabled={busy} onClick={() => excluir(c)} aria-label={`Excluir a conta de ${c.nome}`} title="Excluir">
                              <Trash2 className="size-3.5" />
                            </Botao>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Secao>
    </div>
  );
}

function Convidar({ aoCriar }: { aoCriar: (l: LinkGerado) => Promise<void> }) {
  const [nome, setNome] = useState('');
  const [email, setEmail] = useState('');
  const [perfil, setPerfil] = useState<Perfil>('usuario');
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ids = { nome: useId(), email: useId(), perfil: useId() };
  const rotulo = 'lastro-rotulo mb-1 block text-slate-600 dark:text-slate-400';

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    setErro(null);
    try {
      const j = await chamar<{ link: string }>('/api/usuarios', json({ nome, email, perfil }));
      await aoCriar({ email: email.trim().toLowerCase(), nome: nome.trim(), link: j.link, tipo: 'cadastro' });
      setNome('');
      setEmail('');
      setPerfil('usuario');
    } catch (e) {
      setErro(mensagem(e));
    }
    setOcupado(false);
  }

  return (
    <Secao titulo="Convidar pessoa" descricao="Cria a conta e gera um link de acesso. A pessoa abre o link, cria a senha e configura o authenticator.">
      {erro && <div className="mb-3"><Aviso tipo="erro">{erro}</Aviso></div>}
      <form className="grid items-end gap-3 md:grid-cols-[1fr_1fr_1fr_auto]" onSubmit={enviar}>
        <div>
          <label htmlFor={ids.nome} className={rotulo}>Nome</label>
          <input id={ids.nome} className="lastro-campo h-10 w-full px-3" value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} required />
        </div>
        <div>
          <label htmlFor={ids.email} className={rotulo}>E-mail da Denver</label>
          <input id={ids.email} className="lastro-campo h-10 w-full px-3" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={200} required />
        </div>
        <div>
          <label htmlFor={ids.perfil} className={rotulo}>Perfil</label>
          <select id={ids.perfil} className="lastro-campo h-10 w-full px-2" value={perfil} onChange={(e) => setPerfil(e.target.value as Perfil)}>
            <option value="usuario">Usuário (usa o Lastro)</option>
            <option value="admin">Administrador (também gerencia as contas)</option>
          </select>
        </div>
        <Botao type="submit" variante="primario" disabled={ocupado || !nome || !email}>
          <Plus className="size-4" /> {ocupado ? 'Criando…' : 'Gerar convite'}
        </Botao>
      </form>
    </Secao>
  );
}

function LinkPronto({ link, aoFechar }: { link: LinkGerado; aoFechar: () => void }) {
  const [copiado, setCopiado] = useState(false);
  async function copiar() {
    try {
      await navigator.clipboard.writeText(link.link);
      setCopiado(true);
    } catch {
      setCopiado(false);
    }
  }
  return (
    <section className="lastro-cartao space-y-3 p-5" role="status" aria-live="polite">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-display text-lg tracking-tight">
            <ShieldCheck className="size-5" /> {link.tipo === 'redefinir' ? 'Link de redefinição' : 'Convite'} para {link.nome}
          </h2>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Mande para {link.email} por um canal privado (Teams, WhatsApp). Vale 48 horas, funciona uma vez e <strong>não aparece de novo</strong> aqui.
          </p>
        </div>
        <Botao variante="fantasma" tamanho="sm" onClick={aoFechar} aria-label="Fechar"><X className="size-4" /></Botao>
      </div>
      <div className="flex gap-2">
        <input className="lastro-campo h-10 min-w-0 flex-1 px-3 font-mono text-xs" readOnly value={link.link} onFocus={(e) => e.currentTarget.select()} aria-label="Link de acesso" />
        <Botao variante="primario" onClick={copiar}>
          {copiado ? <Check className="size-4" /> : <Copy className="size-4" />} {copiado ? 'Copiado' : 'Copiar link'}
        </Botao>
      </div>
    </section>
  );
}
