import { Pagina } from '@/components/Pagina';
import { TelaAmostra } from '@/components/amostra/TelaAmostra';

// Gestão › Amostra (frontend/src/pages/Amostra do Bate Lastro).
export default function Tela() {
  return (
    <Pagina titulo="Amostra" subtitulo="Envie o estoque, gere a amostra e siga com ela para o bate. Cada amostra guarda sua seed para conferência.">
      <TelaAmostra />
    </Pagina>
  );
}
