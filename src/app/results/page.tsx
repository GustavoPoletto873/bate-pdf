import Link from 'next/link';
import { Pagina, Vazio } from '@/components/Pagina';
import { IconeRabisco } from '@/components/rabiscos';
import { Resultados } from '@/components/bates/Resultados';

/** Bates › Resultados: /results?base=<id> (como a ResultsPage do Bate Lastro). */
export default async function Tela({ searchParams }: PageProps<'/results'>) {
  const q = await searchParams;
  const valor = q.base ?? q.baseId;
  const baseId = Array.isArray(valor) ? valor[0] : valor;
  if (!baseId) {
    return (
      <Pagina titulo="Resultados" subtitulo="Resultado do matching da base, com exportação para o Inserir Resultado.">
        <Vazio icone={<IconeRabisco tipo="lupa" tamanho={44} />} titulo="Escolha uma base">
          Abra a <Link href="/auditoria-selection" className="underline decoration-dotted">Seleção de Auditoria (Bates)</Link> e entre nos Resultados da base.
        </Vazio>
      </Pagina>
    );
  }
  return <Resultados key={baseId} baseId={baseId} />;
}
