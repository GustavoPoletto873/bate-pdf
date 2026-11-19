/**
 * Rabiscos da identidade "Lastro": os desenhos que caem no rodapé e servem de ícone nos
 * botões (PDF, selos V/D/P, lupa, moeda, clipe e alguns do template original).
 * Cada um ocupa uma caixa de 32 unidades centrada em (0, 0); o traço vem do <svg> pai.
 */

export type Rabisco = 'pdf' | 'v' | 'd' | 'p' | 'lupa' | 'moeda' | 'clipe' | 'star' | 'sparkle' | 'heart' | 'bolt' | 'flame' | 'spiral' | 'plane';

const COR = { flame: '#ff7a1a', flameCore: '#ffd23f', gold: '#ffd23f', heart: '#ff5c7a', pdf: '#e5484d', vidro: '#e0f2fe' };

/** Mesmas cores dos selos V/D/P da tela de bater (emerald, amber e pink do Tailwind). */
const SELOS = {
  v: { fundo: '#d1fae5', letra: '#065f46' },
  d: { fundo: '#fef3c7', letra: '#92400e' },
  p: { fundo: '#fce7f3', letra: '#9d174d' },
};

const FONTE_SELO = '"Arial Black", Arial, sans-serif';

export function DesenhoRabisco({ tipo }: { tipo: Rabisco }) {
  switch (tipo) {
    case 'pdf':
      return (
        <>
          <path fill="#ffffff" d="M-9 -13 L4 -13 L10 -7 L10 13 L-9 13 Z" />
          <path fill="none" d="M4 -13 L4 -7 L10 -7" />
          <path fill="none" strokeWidth="1.3" d="M-5 -7 L0 -7 M-5 9.5 L6 9.5" />
          <rect x="-12.5" y="-2" width="17" height="7.5" rx="1.6" fill={COR.pdf} />
        </>
      );
    case 'v':
    case 'd':
    case 'p':
      return (
        <>
          <rect x="-11" y="-11" width="22" height="22" rx="5" fill={SELOS[tipo].fundo} />
          <text y="1" fontSize="14" fontWeight="900" textAnchor="middle" dominantBaseline="central" stroke="none" fill={SELOS[tipo].letra} fontFamily={FONTE_SELO}>
            {tipo.toUpperCase()}
          </text>
        </>
      );
    case 'lupa':
      return (
        <>
          <path fill="none" strokeWidth="4.2" d="M3.5 3.5 L11 11" />
          <circle cx="-3" cy="-3" r="8.5" fill={COR.vidro} />
          <path fill="none" strokeWidth="1.4" d="M-8 -4 C-7.5 -7 -5.5 -8.5 -3 -8.5" />
        </>
      );
    case 'moeda':
      return (
        <>
          <circle r="12" fill={COR.gold} />
          <circle r="8.6" fill="none" strokeWidth="1.1" />
          <text y="0.8" fontSize="8.5" fontWeight="900" textAnchor="middle" dominantBaseline="central" stroke="none" fill="#7a5600" fontFamily={FONTE_SELO}>
            R$
          </text>
        </>
      );
    case 'clipe':
      return <path fill="none" strokeWidth="2.3" d="M-2 10 L-2 -7 C-2 -12.5 6 -12.5 6 -7 L6 8 C6 14 -6.5 14 -6.5 8 L-6.5 -3" />;
    case 'flame':
      return (
        <>
          <path fill={COR.flame} d="M0 14 C-9 14 -12 6 -10 0 C-8 -5 -4 -6 -4 -12 C1 -9 3 -5 2 -1 C4 -3 5 -6 5 -8 C10 -3 11 4 8 9 C6 12 3 14 0 14 Z" />
          <path fill={COR.flameCore} d="M0 11.5 C-4 11.5 -6 8 -5 5 C-4 2 -1 1 -1 -3 C2 -1 4 3 3 6 C4 5 5 4 5 3 C7 6 5 11.5 0 11.5 Z" />
        </>
      );
    case 'star':
      return <path fill={COR.gold} d="M0 -13 L3.6 -4.4 L13 -4 L5.8 2.2 L8.2 12 L0 6.6 L-8.2 12 L-5.8 2.2 L-13 -4 L-3.6 -4.4 Z" />;
    case 'heart':
      return <path fill={COR.heart} d="M0 11 C-6 6 -13 1 -13 -5 C-13 -10 -8 -13 -4 -11 C-2 -10 -1 -8 0 -6 C1 -8 2 -10 4 -11 C8 -13 13 -10 13 -5 C13 1 6 6 0 11 Z" />;
    case 'bolt':
      return <path fill={COR.gold} d="M3 -14 L-8 2 L-1 2 L-4 14 L8 -3 L1 -3 Z" />;
    case 'sparkle':
      return <path fill="#8fdcff" d="M0 -13 C1 -4 4 -1 13 0 C4 1 1 4 0 13 C-1 4 -4 1 -13 0 C-4 -1 -1 -4 0 -13 Z" />;
    case 'spiral':
      return <path fill="none" d="M0 0 C2 -2 4 0 3 3 C1 6 -4 5 -5 1 C-6 -4 -1 -8 4 -7 C9 -5 10 2 7 6" />;
    case 'plane':
      return (
        <>
          <path className="dcf-paperfill" fill="#ffffff" d="M-13 -1 L13 -10 L4 12 L0 3 Z" />
          <path fill="none" d="M0 3 L13 -10 M0 3 L-2 9 L2 5" />
        </>
      );
  }
}

/** Rabisco como ícone: o traço segue a cor do texto (currentColor). */
export function IconeRabisco({ tipo, tamanho = 18, className }: { tipo: Rabisco; tamanho?: number; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="-16 -16 32 32"
      width={tamanho}
      height={tamanho}
      stroke="currentColor"
      strokeWidth={1.9}
      strokeLinejoin="round"
      strokeLinecap="round"
      overflow="visible"
      aria-hidden="true"
    >
      <DesenhoRabisco tipo={tipo} />
    </svg>
  );
}
