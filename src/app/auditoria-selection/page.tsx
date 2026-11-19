import { Pagina } from '@/components/Pagina';
import { SelecaoAuditoria } from '@/components/selecao/SelecaoAuditoria';
import { lerStatus } from '@/app/api/auditorias/selecao';

export default async function Tela({ searchParams }: PageProps<'/auditoria-selection'>) {
  const { status } = await searchParams;
  return (
    <Pagina titulo="Seleção de Auditoria" subtitulo="Encontre uma base para continuar o trabalho ou começar uma nova auditoria." largura="max-w-7xl">
      <SelecaoAuditoria statusInicial={lerStatus(status) ?? 'a_iniciar'} />
    </Pagina>
  );
}
