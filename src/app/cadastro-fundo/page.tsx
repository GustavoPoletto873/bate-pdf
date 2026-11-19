import { Pagina } from '@/components/Pagina';
import { CadastroFundos } from '@/components/fundos/CadastroFundos';

export default function Tela() {
  return (
    <Pagina
      titulo="Fundos"
      subtitulo="Cadastre os fundos (nome, CNPJ, administradora, tipo e gestor) um a um ou por planilha. O Upload Base, o Anexo e a Amostra escolhem o fundo desta lista."
      largura="max-w-7xl"
    >
      <CadastroFundos />
    </Pagina>
  );
}
