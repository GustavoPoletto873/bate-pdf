import { Pagina } from '@/components/Pagina';
import { CarregarDashboard } from '@/components/dashboard/CarregarDashboard';

// Análise › Dashboard (frontend/src/pages/Home/HomeNew.jsx do Bate Lastro).
export default function Tela() {
  return (
    <Pagina titulo="Dashboard" subtitulo="Visão geral das auditorias: bases a iniciar, em andamento e finalizadas, bates e pendências por fundo." largura="max-w-7xl">
      <CarregarDashboard />
    </Pagina>
  );
}
