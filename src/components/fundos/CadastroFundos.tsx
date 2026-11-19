'use client';

import { useEffect, useState } from 'react';
import type { Administradora } from '@/lib/fundos';
import { apiFundos } from '@/lib/cliente/fundos';
import { FormularioFundo } from './FormularioFundo';
import { ImportacaoFundos } from './ImportacaoFundos';
import { ListaFundos } from './ListaFundos';

/** Gestão › Fundos: cadastro individual, importação em lote e a lista (CadastroFundo.jsx). */
export function CadastroFundos() {
  const [administradoras, setAdministradoras] = useState<Administradora[]>([]);
  const [versao, setVersao] = useState(0);

  useEffect(() => {
    let vivo = true;
    // Lista vazia só deixa a escolha sem opções; o cadastro segue.
    apiFundos.administradoras().then((a) => { if (vivo) setAdministradoras(a); }).catch(() => {});
    return () => { vivo = false; };
  }, [versao]);

  const criada = (a: Administradora) =>
    setAdministradoras((lista) => [...lista, a].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR', { sensitivity: 'base' })));
  const alterou = () => setVersao((v) => v + 1);

  return (
    <div className="space-y-8">
      <div className="grid gap-8 xl:grid-cols-2">
        <FormularioFundo administradoras={administradoras} onAdministradoraCriada={criada} onCadastrado={alterou} />
        <ImportacaoFundos onImportado={alterou} />
      </div>
      <ListaFundos administradoras={administradoras} onAdministradoraCriada={criada} versao={versao} onAlterado={() => setVersao((v) => v + 1)} />
    </div>
  );
}
