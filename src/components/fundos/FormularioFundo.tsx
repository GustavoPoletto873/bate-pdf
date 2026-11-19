'use client';

import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import type { Administradora, Fundo } from '@/lib/fundos';
import { apiFundos } from '@/lib/cliente/fundos';
import { Secao } from '@/components/Pagina';
import { Aviso, Botao, Dialogo, cx } from '@/components/ui';
import { mascaraCnpj, mensagemDeErro } from './util';

const TIPOS = [{ valor: 'FIDC', rotulo: 'FIDC' }, { valor: 'FIC_FIDC', rotulo: 'FIC FIDC' }];

/** Escolha da administradora com "Nova administradora" ao lado (o cadastro de administradoras é local). */
export function EscolhaAdministradora({ id, valor, onChange, administradoras, onCriada, vazio = 'Não informado', className, disabled }: {
  id?: string;
  valor: string;
  onChange: (v: string) => void;
  administradoras: Administradora[];
  onCriada: (a: Administradora) => void;
  vazio?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);

  async function criar() {
    setSalvando(true);
    setErro(null);
    try {
      const a = await apiFundos.criarAdministradora(nome);
      onCriada(a);
      onChange(String(a.id));
      setAberto(false);
      setNome('');
    } catch (e) {
      setErro(mensagemDeErro(e, 'Não foi possível cadastrar a administradora. Tente de novo.'));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className={cx('flex gap-2', className)}>
      <select id={id} value={valor} onChange={(e) => onChange(e.target.value)} disabled={disabled} className="lastro-campo h-10 min-w-0 flex-1 px-3 text-sm">
        <option value="">{vazio}</option>
        {administradoras.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
      </select>
      <Botao onClick={() => { setAberto(true); setErro(null); }} disabled={disabled} title="Cadastrar uma administradora que ainda não está na lista" className="h-10">
        <Plus className="size-4" /> Nova
      </Botao>
      <Dialogo
        aberto={aberto}
        titulo="Nova administradora"
        onFechar={() => setAberto(false)}
        rodape={<>
          <Botao variante="fantasma" onClick={() => setAberto(false)}>Cancelar</Botao>
          <Botao variante="primario" onClick={criar} disabled={salvando || !nome.trim()}>{salvando ? 'Salvando…' : 'Cadastrar'}</Botao>
        </>}
      >
        {/* Sem <form>: o diálogo é desenhado dentro do formulário do fundo. */}
        <div className="space-y-3">
          <p className="font-serif text-sm text-slate-600 dark:text-slate-400">
            Escreva o nome como ele deve aparecer na lista e na aba Administradores do modelo da planilha de fundos.
          </p>
          <label className="block text-sm">
            <span className="lastro-rotulo">Nome da administradora</span>
            <input
              autoFocus value={nome} maxLength={120} onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (nome.trim() && !salvando) criar(); } }}
              className="lastro-campo mt-1 h-10 w-full px-3" placeholder="Ex.: Administradora Exemplo S.A." />
          </label>
          {erro && <Aviso tipo="erro">{erro}</Aviso>}
        </div>
      </Dialogo>
    </div>
  );
}

/** Cadastro individual (Nome, CNPJ, Administradora, Tipo e Gestor). */
export function FormularioFundo({ administradoras, onAdministradoraCriada, onCadastrado }: {
  administradoras: Administradora[];
  onAdministradoraCriada: (a: Administradora) => void;
  onCadastrado: (f: Fundo) => void;
}) {
  const vazio = { nome: '', cnpj: '', administradora: '', tipo: 'FIDC', gestor: '' };
  const [form, setForm] = useState(vazio);
  const [salvando, setSalvando] = useState(false);
  const [mensagem, setMensagem] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null);
  const digitos = form.cnpj.replace(/\D/g, '').length;

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setMensagem(null);
    try {
      const fundo = await apiFundos.criar({
        nome: form.nome, cnpj: form.cnpj, tipo: form.tipo,
        administradora_id: form.administradora ? Number(form.administradora) : null,
        gestor: form.gestor || null,
      });
      setForm(vazio);
      setMensagem({ tipo: 'ok', texto: `Fundo "${fundo.nome}" cadastrado.` });
      onCadastrado(fundo);
    } catch (err) {
      setMensagem({ tipo: 'erro', texto: mensagemDeErro(err, 'Não foi possível cadastrar o fundo. Tente de novo.') });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Secao titulo="Cadastro individual" descricao="Um fundo por vez. O CNPJ não pode repetir e é conferido pelo dígito verificador.">
      <form onSubmit={enviar} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block text-sm">
            <span className="lastro-rotulo">Nome do fundo</span>
            <input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} className="lastro-campo mt-1 h-10 w-full px-3" placeholder="Nome completo do fundo" />
          </label>
          <label className="block text-sm">
            <span className="lastro-rotulo">CNPJ</span>
            <input
              required inputMode="numeric" value={form.cnpj}
              onChange={(e) => setForm({ ...form, cnpj: mascaraCnpj(e.target.value) })}
              className="lastro-campo mt-1 h-10 w-full px-3 font-mono" placeholder="00.000.000/0000-00"
            />
            {digitos > 0 && digitos < 14 && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{digitos} de 14 dígitos</span>}
          </label>
          <div className="text-sm">
            <label htmlFor="fundo-administradora" className="lastro-rotulo">Administradora</label>
            <EscolhaAdministradora
              id="fundo-administradora" className="mt-1" valor={form.administradora}
              onChange={(v) => setForm({ ...form, administradora: v })}
              administradoras={administradoras} onCriada={onAdministradoraCriada}
            />
          </div>
          <div className="text-sm">
            <span className="lastro-rotulo">Tipo de fundo</span>
            <div role="radiogroup" aria-label="Tipo de fundo" className="mt-1 flex h-10 gap-1 rounded-full border-[1.5px] border-slate-300 p-1 dark:border-slate-600">
              {TIPOS.map((t) => (
                <button
                  key={t.valor} type="button" role="radio" aria-checked={form.tipo === t.valor}
                  onClick={() => setForm({ ...form, tipo: t.valor })}
                  className={cx('flex-1 rounded-full text-sm font-semibold transition-colors',
                    form.tipo === t.valor ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800')}
                >
                  {t.rotulo}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm md:col-span-2">
            <span className="lastro-rotulo">Gestor (opcional)</span>
            <input value={form.gestor} maxLength={120} onChange={(e) => setForm({ ...form, gestor: e.target.value })} className="lastro-campo mt-1 h-10 w-full px-3" placeholder="Não informado" />
          </label>
        </div>
        {mensagem && <Aviso tipo={mensagem.tipo}>{mensagem.texto}</Aviso>}
        <Botao type="submit" variante="primario" disabled={salvando}>
          <Plus className="size-4" /> {salvando ? 'Cadastrando…' : 'Cadastrar fundo'}
        </Botao>
      </form>
    </Secao>
  );
}
