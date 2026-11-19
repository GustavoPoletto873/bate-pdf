import { Pagina } from '@/components/Pagina';
import { Visualizar } from '@/components/visualizar/Visualizar';

/** Análise › Visualizar (Visualização de Dados do Bate Lastro): todas as leituras, com filtros e Excel. */
export default function Tela() {
  return (
    <Pagina titulo="Visualização de Dados" subtitulo="Todas as leituras dos documentos (IA, XML de NF-e e as demais), com filtros e exportação para Excel." largura="max-w-[1400px]">
      <Visualizar />
    </Pagina>
  );
}
