import { BaterPdf } from '@/components/bater/BaterPdf';

export default async function Pagina({ params }: PageProps<'/bases/[id]'>) {
  const { id } = await params;
  return <BaterPdf baseId={id} />;
}
