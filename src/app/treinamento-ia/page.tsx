import { Pagina } from '@/components/Pagina';
import { TelaTreino } from '@/components/treino/TelaTreino';

// Gestão › Treinar IA (frontend/src/pages/TreinamentoIA do Bate Lastro).
export default function Tela() {
  return (
    <Pagina titulo="Treinar IA" subtitulo="Ensine a IA a reconhecer e ler documentos que ela ainda não conhece. Os tipos treinados entram na classificação e na leitura do Anexo.">
      <TelaTreino />
    </Pagina>
  );
}
