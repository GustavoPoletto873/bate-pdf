/**
 * Roda uma vez quando o servidor do Next inicia: a fila local de leitura do Anexo marca como
 * falha o que ficou "processando" (sem refazer: cada chamada ao Gemini é cobrada) e retoma os
 * documentos pendentes. Não roda no `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  const { iniciarFila } = await import('@/lib/anexo/fila');
  iniciarFila();
}
