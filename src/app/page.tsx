import { RodapeLastro } from '@/components/RodapeLastro';
import { Inicio } from '@/components/inicio/Inicio';
import { montarPainelInicio } from '@/components/inicio/painel';

// Lê o banco e a hora a cada visita (saudação e "continue de onde parou").
export const dynamic = 'force-dynamic';

export default function PaginaInicial() {
  const painel = montarPainelInicio();
  return (
    <>
      <Inicio painel={painel} />
      {/* shrink-0: o <main> tem altura fixa; sem isso o rodapé seria espremido e cortado. */}
      <RodapeLastro className="mt-16 shrink-0" />
    </>
  );
}
