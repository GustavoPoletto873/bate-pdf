import Link from 'next/link';
import { Pagina, Vazio } from '@/components/Pagina';
import { IconeRabisco } from '@/components/rabiscos';
import { GestaoDeBates } from '@/components/bates/GestaoDeBates';

/** Bates › Gestão de Bates: /pre-matches?base=<id> (como a PreMatchesPage do Bate Lastro). */
export default async function Tela({ searchParams }: PageProps<'/pre-matches'>) {
  const q = await searchParams;
  const valor = q.base ?? q.baseId;
  const baseId = Array.isArray(valor) ? valor[0] : valor;
  if (!baseId) {
    return (
      <Pagina titulo="Gestão de Bates" subtitulo="Processe a base, confirme os pré-bates e resolva as pendências.">
        <Vazio icone={<IconeRabisco tipo="lupa" tamanho={44} />} titulo="Escolha uma base para começar">
          Abra a <Link href="/auditoria-selection" className="underline decoration-dotted">Seleção de Auditoria (Bates)</Link> e clique na base que você quer processar.
        </Vazio>
      </Pagina>
    );
  }
  return <GestaoDeBates key={baseId} baseId={baseId} />;
}
