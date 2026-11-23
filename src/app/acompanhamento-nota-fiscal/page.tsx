import { Pagina } from '@/components/Pagina';
import { TelaNotasFiscais } from '@/components/nf/TelaNotasFiscais';

// Análise › NF Status (frontend/src/pages/AcompanhamentoNotaFiscal do Bate Lastro).
export default function Tela() {
  return (
    <Pagina titulo="NF Status" subtitulo="A situação de cada NF-e das bases: ativa ou cancelada, pelo XML lido no Anexo ou pela consulta no SERPRO.">
      <TelaNotasFiscais />
    </Pagina>
  );
}
