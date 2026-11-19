import { Pagina } from '@/components/Pagina';
import { UploadBase } from '@/components/upload-base/UploadBase';

export default async function Tela({ searchParams }: PageProps<'/base'>) {
  const { amostra } = await searchParams;
  const amostraId = typeof amostra === 'string' && amostra.trim() ? amostra.trim() : null;
  return (
    <Pagina
      titulo="Upload Base"
      subtitulo="Registre a base de direitos creditórios do fundo: escolha o fundo e a data de referência, envie a planilha e confira o mapeamento das colunas."
    >
      {/* key: "Usar como base" de outra amostra remonta a tela já preenchida. */}
      <UploadBase key={amostraId ?? 'nova'} amostraId={amostraId} />
    </Pagina>
  );
}
