/** Desenho do logo "Lastro": uma página com o V de confere. Segue o tema (claro/escuro). */
export function DesenhoLogoLastro({ tamanho = 26 }: { tamanho?: number }) {
  return (
    <svg
      viewBox="-16 -16 32 32"
      width={tamanho}
      height={tamanho}
      style={{ fill: 'var(--lastro-cartao)', stroke: 'var(--lastro-tinta)' }}
      strokeWidth={1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      overflow="visible"
      aria-hidden="true"
    >
      <path d="M-9 -13 L4 -13 L10 -7 L10 13 L-9 13 Z" />
      <path fill="none" d="M4 -13 L4 -7 L10 -7" />
      <path fill="none" d="M-5 1.5 L-1.5 5 L5.5 -2.5" stroke="#10b981" strokeWidth={2.8} />
    </svg>
  );
}

/** O logo no selo redondo de traço de tinta (cabeçalho). Gira de leve no hover do pai `group`. */
export function LogoLastro({ tamanho = 32 }: { tamanho?: number }) {
  return (
    <span
      className="grid shrink-0 -rotate-6 place-items-center rounded-full border-2 border-slate-900 bg-white transition-transform duration-300 group-hover:rotate-6 group-hover:scale-105 dark:border-slate-200 dark:bg-slate-900"
      style={{ width: tamanho, height: tamanho }}
      aria-hidden="true"
    >
      <DesenhoLogoLastro tamanho={Math.round(tamanho * 0.66)} />
    </span>
  );
}
