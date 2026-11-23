/**
 * Roda uma vez quando o servidor do Next inicia: a fila local de leitura do Anexo marca como
 * falha o que ficou "processando" (sem refazer: cada chamada ao Gemini é cobrada) e retoma os
 * documentos pendentes. Não roda no `next build`.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.NEXT_PHASE === 'phase-production-build') return;
  // Na nuvem não há servidor contínuo: a fila é retomada pelas rotas que acompanham os lotes.
  if (process.env.VERCEL) return;
  const { iniciarFila } = await import('@/lib/anexo/fila');
  void iniciarFila();
}
