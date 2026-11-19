import { Pagina } from '@/components/Pagina';
import { Anexo } from '@/components/anexo/Anexo';

export const dynamic = 'force-dynamic';

/** Gestão › Anexo: documentos da base, lidos pelo Gemini (frontend/src/pages/Anexo do Bate Lastro). `?base=<id>` pula para a base. */
export default async function Tela({ searchParams }: PageProps<'/anexo'>) {
  const p = await searchParams;
  const base = typeof p.base === 'string' ? p.base : null;
  return (
    <Pagina titulo="Anexo" subtitulo="Envie os documentos (termos de cessão e lastros) da base. Cada PDF é classificado e lido pela IA (Gemini), como no Bate Lastro; XML de NF-e é lido aqui mesmo.">
      <Anexo baseInicial={base} />
    </Pagina>
  );
}
