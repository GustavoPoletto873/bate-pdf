import { Pagina } from '@/components/Pagina';
import { TelaRelatorios } from '@/components/relatorios/TelaRelatorios';

// Gestão › Relatórios CVM/NIX (frontend/src/pages/Relatorios do Bate Lastro).
export default function Tela() {
  return (
    <Pagina titulo="Relatórios CVM/NIX" subtitulo="Carteira do informe mensal da CVM + base de auditoria do trimestre → revisão dos textos → .docx nos modelos do Bate Lastro.">
      <TelaRelatorios />
    </Pagina>
  );
}
