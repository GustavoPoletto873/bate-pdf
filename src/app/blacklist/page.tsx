import { Pagina } from '@/components/Pagina';
import { TelaBlackList } from '@/components/blacklist/TelaBlackList';

// Gestão › BlackList (frontend/src/pages/BlackList do Bate Lastro).
export default function Tela() {
  return (
    <Pagina titulo="BlackList" subtitulo="Cedentes e sacados monitorados nas bases de todos os fundos: o Lastro avisa quando aparecem, sem bloquear nada.">
      <TelaBlackList />
    </Pagina>
  );
}
