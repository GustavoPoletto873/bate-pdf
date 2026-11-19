'use client';

import Link from 'next/link';
import * as React from 'react';
import { DesenhoLogoLastro } from '@/components/LogoLastro';
import { AsasDoPassarinho, Baixista, CSS_BAIXISTA, type ReacaoBx, type RoteiroBaixista } from '@/components/Baixista';
import { DesenhoRabisco, IconeRabisco, type Rabisco } from '@/components/rabiscos';

/**
 * Rodapé "Lastro", adaptado do template Doodle Crew Footer (21st.dev).
 *
 * A palavra LASTRO carimbada em tinta, uma turma desenhada à mão morando nas letras
 * (o Termo, a Duplicata, o Campo em P, a Analista, a Divergência e o Sacado) e os
 * rabiscos do nosso dia a dia caindo em volta: PDFs, selos V/D/P, lupa, moeda e clipe.
 *
 * Quando entra na tela, roda como um storyboard: a linha do chão se desenha, as letras
 * carimbam uma a uma, a turma chega, os rabiscos começam a cair e a frase e os botões
 * sobem por último. Depois fica vivo: os olhos seguem o ponteiro (e piscam), as linhas
 * "fervem" como animação feita à mão, um clique num personagem faz ele pular e falar, e
 * os rabiscos fogem do ponteiro e estouram quando você pega um.
 *
 * Sem dependências e sem nada baixado da internet (o app tem que rodar offline): todo
 * desenho é SVG inline e a textura de tinta é um filtro SVG. Fundo sempre branco.
 */

// #region turma
// Funções puras: diagramação da palavra, assentos, olhar, deriva dos rabiscos e o
// tempo do storyboard. Iguais às do template.

/** Hash determinístico pequeno → [0, 1): toda renderização monta a cena do mesmo jeito. */
const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

/**
 * Posiciona a palavra a partir do avanço de cada letra (em unidades da fonte): a borda
 * esquerda de cada letra, com `tracking` (em em) entre elas, e a largura total. Avanço
 * inválido ou negativo conta como zero, para um glifo ruim não desmontar a palavra.
 */
const layoutWord = (advances: number[], tracking: number, fontSize: number): { x: number[]; w: number[]; width: number } => {
  const x: number[] = [];
  const w: number[] = [];
  let at = 0;
  const gap = (Number.isFinite(tracking) ? tracking : 0) * fontSize;
  for (let i = 0; i < advances.length; i++) {
    const a = Number.isFinite(advances[i]) && advances[i] > 0 ? advances[i] : 0;
    x.push(at);
    w.push(a);
    at += a + (i < advances.length - 1 ? gap : 0);
  }
  return { x, w, width: Math.max(0, at) };
};

type Seat = 'front' | 'top' | 'behind';

/**
 * Onde um personagem fica, em unidades da palavra (linha de base em y = 0, para cima é
 * negativo). `front` fica no chão na frente da letra, `top` senta em cima da letra,
 * `behind` sobe por trás da letra e só aparece acima da borda. `offset` desliza ao longo
 * da letra, em larguras de letra.
 */
const seatPoint = (seat: Seat, letterX: number, letterW: number, cap: number, offset: number, scale: number): { x: number; y: number } => {
  const x = letterX + letterW * (0.5 + (Number.isFinite(offset) ? offset : 0));
  if (seat === 'top') return { x, y: -cap };
  if (seat === 'behind') return { x, y: -cap + 30 * scale };
  return { x, y: 0 };
};

/**
 * Onde a pupila fica dentro do olho: apontada para o alvo, nunca a mais de `max` do
 * centro, e aliviando quando o alvo chega perto para o olho não dar tranco.
 */
const lookAt = (ex: number, ey: number, tx: number, ty: number, max: number, reach: number): { x: number; y: number } => {
  const dx = tx - ex;
  const dy = ty - ey;
  const d = Math.hypot(dx, dy);
  if (!Number.isFinite(d) || d < 1e-6 || max <= 0) return { x: 0, y: 0 };
  const k = (max * Math.min(1, d / Math.max(1e-6, reach))) / d;
  return { x: dx * k, y: dy * k };
};

type Floater = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  fall: number;
  phase: number;
  /** Segundos restantes do estouro; 0 = vivo. */
  pop: number;
};

/**
 * Um passo da deriva de um rabisco: cai na própria velocidade e balança, o ponteiro
 * empurra dentro de `radius`, volta à deriva quando solto e dá a volta na caixa para o
 * céu nunca esvaziar. Um rabisco estourado espera o tempo e volta pelo topo.
 */
const stepFloater = (f: Floater, dt: number, t: number, w: number, h: number, px: number, py: number, radius: number, rand: () => number): Floater => {
  const step = clamp(Number.isFinite(dt) ? dt : 0, 0, 0.05);
  const m = 40;
  if (f.pop > 0) {
    f.pop -= step;
    if (f.pop <= 0) {
      f.pop = 0;
      f.x = rand() * w;
      f.y = -m;
      f.vx = 0;
      f.vy = f.fall;
    }
    return f;
  }
  const sway = Math.sin(t * 0.7 + f.phase) * 14;
  if (Number.isFinite(px) && Number.isFinite(py) && radius > 0) {
    const dx = f.x - px;
    const dy = f.y - py;
    const d = Math.hypot(dx, dy);
    if (d < radius && d > 0.01) {
      const k = (1 - d / radius) * (1 - d / radius) * 2400;
      f.vx += (dx / d) * k * step;
      f.vy += (dy / d) * k * step;
      f.vr += (dx > 0 ? 1 : -1) * k * 0.004 * step;
    }
  }
  const ease = Math.min(1, step * 2.4);
  f.vx += (sway - f.vx) * ease;
  f.vy += (f.fall - f.vy) * ease;
  f.vr += (Math.sin(f.phase * 3) * 18 - f.vr) * Math.min(1, step * 0.8);
  f.x += f.vx * step;
  f.y += f.vy * step;
  f.rot = (f.rot + f.vr * step) % 360;
  if (f.y > h + m) {
    f.y = -m;
    f.x = rand() * w;
  } else if (f.y < -m * 3) {
    f.y = h + m;
  }
  if (f.x < -m) f.x = w + m;
  else if (f.x > w + m) f.x = -m;
  return f;
};

/**
 * O storyboard, em ms a partir do momento em que o rodapé entra na tela: o chão se
 * desenha, as letras carimbam da esquerda para a direita, a turma chega quando a palavra
 * está no chão, depois os rabiscos, a frase palavra por palavra e os botões.
 */
const timeline = (letters: number, crew: number, words: number, actions: number) => {
  const L = Math.max(0, Math.floor(letters) || 0);
  const C = Math.max(0, Math.floor(crew) || 0);
  const W = Math.max(0, Math.floor(words) || 0);
  const A = Math.max(0, Math.floor(actions) || 0);
  const letter = (i: number) => 160 + i * 80;
  const crewStart = letter(Math.max(0, L - 1)) + 420;
  const member = (j: number) => crewStart + j * 130;
  const doodles = crewStart + Math.max(0, C - 1) * 130 * 0.5;
  const copy = crewStart + 260;
  const word = (k: number) => copy + k * 45;
  const actionsStart = word(W) + 120;
  const action = (k: number) => actionsStart + k * 110;
  const total = Math.max(member(Math.max(0, C - 1)) + 720, action(Math.max(0, A - 1)) + 600, letter(Math.max(0, L - 1)) + 560);
  return { ground: 60, letter, crewStart, member, doodles, word, action, total };
};

// #endregion

type CrewKind = 'yeti' | 'kid' | 'bird' | 'cat' | 'ghost' | 'mushroom';

interface CrewMember {
  kind: CrewKind;
  /** Índice da letra da palavra onde ele mora. */
  letter: number;
  /** `front` na frente da letra, `top` sentado nela, `behind` espiando por trás. Padrão por tipo. */
  seat?: Seat;
  /** Desliza ao longo da letra, em larguras de letra. 0 = centro. */
  offset?: number;
  /** Tamanho em relação à letra. Padrão 1. */
  scale?: number;
  /** Vira para o outro lado. */
  flip?: boolean;
  /** Usado no rótulo acessível. */
  name?: string;
  /** O que ele fala ao ser clicado. */
  says?: string;
}

interface FooterLink {
  label: string;
  href?: string;
}

interface FooterColumn {
  title: string;
  links: FooterLink[];
}

interface FooterAction {
  label: string;
  href?: string;
  icon?: Rabisco;
  variant?: 'solid' | 'outline';
  onClick?: () => void;
}

export interface RodapeLastroProps {
  /** A palavra gigante. Curta e em maiúsculas. */
  wordmark?: string;
  /** Nome no canto superior esquerdo. */
  brand?: string;
  /** Uma ou duas frases sob o nome. */
  blurb?: string;
  /** A frase sob a palavra. */
  tagline?: string;
  columns?: FooterColumn[];
  /** Os botões sob a frase. */
  actions?: FooterAction[];
  /** Barra de baixo, à esquerda. */
  copyright?: string;
  legal?: FooterLink[];
  socials?: FooterLink[];
  /** Botão "Voltar ao topo" na barra de baixo. */
  backToTop?: boolean;
  crew?: CrewMember[];
  /** Rabiscos que caem em volta da palavra. Lista vazia desliga. */
  doodles?: Rabisco[];
  /** Quantos rabiscos ao mesmo tempo. */
  doodleCount?: number;
  palette?: { background?: string; ink?: string; accent?: string };
  /** Fonte da palavra. Grotescas pesadas carimbam melhor. */
  fontFamily?: string;
  /** Fonte da frase e do texto sob o nome. */
  serifFamily?: string;
  /** Espaçamento entre letras da palavra, em em. */
  tracking?: number;
  /** Ponteiro, hover e clique. */
  interactive?: boolean;
  /** Altura mínima. O rodapé cresce se o conteúdo pedir. */
  height?: string;
  className?: string;
}

// ---- o nosso conteúdo -----------------------------------------------------------------

/** As cores do tema do app (globals.css): papel branco e tinta escura, ou o inverso no modo escuro. */
const CORES = { background: 'var(--lastro-fundo)', ink: 'var(--lastro-tinta)', accent: 'var(--lastro-destaque)' };

const TURMA: CrewMember[] = [
  // Encostado no L (mais à esquerda que no template: o L é estreito e sumiria atrás dele).
  { kind: 'yeti', letter: 0, seat: 'front', offset: -0.82, name: 'Termo', says: 'Sou o termo de cessão. Cadê meu lastro?' },
  { kind: 'bird', letter: 1, seat: 'top', offset: 0.02, name: 'Duplicata', says: 'Piu! Vencimento bateu: V.' },
  { kind: 'ghost', letter: 2, seat: 'behind', name: 'Campo em P', says: 'Buu! Campo em P não vincula.' },
  { kind: 'kid', letter: 3, seat: 'top', offset: -0.05, name: 'Analista', says: 'Daqui de cima eu acho qualquer CPF.' },
  { kind: 'mushroom', letter: 4, seat: 'front', offset: 0.1, scale: 0.95, name: 'Divergência', says: 'Brotei no valor. Marca D.' },
  { kind: 'cat', letter: 5, seat: 'front', offset: 0.42, flip: true, name: 'Sacado', says: 'Esse CPF é meu, pode dar V.' },
];

const COLUNAS: FooterColumn[] = [
  { title: 'Começar', links: [{ label: 'Upload Base', href: '/base' }, { label: 'Anexo', href: '/anexo' }, { label: 'Fundos', href: '/cadastro-fundo' }, { label: 'Bates', href: '/auditoria-selection' }] },
  { title: 'Passo a passo', links: [{ label: 'Registrar a base', href: '/base' }, { label: 'Anexar documentos', href: '/anexo' }, { label: 'Acompanhar leituras', href: '/lotes' }, { label: 'Fazer os bates', href: '/auditoria-selection' }] },
  { title: 'Vereditos', links: [{ label: 'V · confere' }, { label: 'D · divergente' }, { label: 'P · não decidido' }] },
  { title: 'Retorno', links: [{ label: 'Resultados', href: '/results' }, { label: 'Exportar a planilha' }, { label: 'Inserir Resultado' }] },
];

const ACOES: FooterAction[] = [
  { label: 'Ver as bases', href: '/auditoria-selection', icon: 'lupa', variant: 'outline' },
  { label: 'Registrar uma base', href: '/base', icon: 'pdf', variant: 'solid' },
];

const RABISCOS: Rabisco[] = ['pdf', 'v', 'lupa', 'd', 'moeda', 'pdf', 'p', 'clipe', 'v', 'sparkle'];

// ---- os desenhos da turma -------------------------------------------------------------
// Cada tipo é desenhado nas próprias unidades: centro da base em (0, 0), para cima é
// negativo, cerca de 144 unidades para a altura de uma maiúscula. Os olhos ficam à parte
// para o renderizador poder mirar e piscar.

type Eye = { x: number; y: number; r: number; pupil: number; max: number };
type Art = {
  /** Tamanho em relação às letras, antes da escala do personagem. */
  k: number;
  box: { l: number; r: number; t: number; b: number };
  eyes: Eye[];
  seat: Seat;
  body: (hatch: string) => React.ReactNode;
  front?: () => React.ReactNode;
  idle?: string;
};

const ART: Record<CrewKind, Art> = {
  yeti: {
    k: 1,
    box: { l: -72, r: 60, t: -140, b: 6 },
    seat: 'front',
    eyes: [
      { x: -15, y: -86, r: 8, pupil: 3.6, max: 3.6 },
      { x: 13, y: -88, r: 8, pupil: 3.6, max: 3.6 },
    ],
    body: (hatch) => (
      <>
        <ellipse className="dcf-shadow" cx="0" cy="2" rx="54" ry="5" />
        <path d="M-40 -92 C-62 -92 -70 -76 -68 -56 L-66 -30 C-64 -18 -54 -16 -44 -20 Z" />
        <path d="M-40 -92 C-62 -92 -70 -76 -68 -56 L-66 -30 C-64 -18 -54 -16 -44 -20 Z" fill={hatch} stroke="none" />
        <path className="n" d="M-67 -64 C-58 -59 -50 -59 -43 -64" />
        <path d="M-30 -104 C-40 -112 -44 -124 -40 -138 C-32 -129 -22 -122 -13 -114 Z" />
        <path d="M18 -114 C26 -124 36 -130 47 -133 C45 -120 41 -110 32 -101 Z" />
        <path className="n" d="M-38 -124 L-28 -119 M39 -125 L33 -116" />
        <path d="M-44 -2 C-54 -28 -54 -66 -42 -90 C-32 -110 -14 -118 2 -118 C22 -118 40 -108 48 -88 C58 -64 58 -28 48 -2 C30 4 -26 4 -44 -2 Z" />
        <path d="M40 -96 C54 -66 54 -30 46 -4 C40 -2 34 -1 30 0 C40 -30 42 -64 33 -101 Z" fill={hatch} stroke="none" />
        <path className="n" d="M-7 -117 C-5 -126 1 -128 3 -120 C5 -127 11 -126 11 -116" />
        <path className="n thin" d="M-14 -24 l-3 4 M8 -40 l3 4 M14 -46 l3 3 M20 -30 l3 3" />
        <path className="n" d="M-48 -62 C-22 -50 10 -32 49 -26 M-50 -52 C-24 -40 8 -22 49 -16" />
        <rect x="-12" y="-46" width="15" height="13" rx="2.5" transform="rotate(26 -4.5 -39.5)" />
        <path d="M-46 -60 C-62 -50 -63 -29 -51 -19 C-45 -15 -38 -19 -40 -28 C-43 -36 -40 -46 -36 -52" />
        <path d="M46 -58 C61 -46 61 -26 51 -18 C45 -14 38 -18 40 -26 C43 -34 41 -44 37 -50" />
        <path d="M-37 -2 C-41 -14 -23 -19 -16 -7 C-14 0 -26 4 -37 -2 Z" />
        <path d="M37 -2 C41 -14 23 -19 16 -7 C14 0 26 4 37 -2 Z" />
        <path className="n thin" d="M-30 -4 l1 -4 M-24 -3 l1 -4 M30 -4 l-1 -4 M24 -3 l-1 -4" />
        <path className="n" d="M-23 -98 L-9 -96 M6 -98 L20 -100" />
        <path className="n" d="M-12 -70 C-6 -64 6 -64 12 -71" />
        <path d="M3 -66.5 L5.5 -60 L8 -67.5 Z" />
      </>
    ),
  },
  kid: {
    k: 1.28,
    box: { l: -30, r: 30, t: -88, b: 42 },
    seat: 'top',
    eyes: [
      { x: -6, y: -58, r: 0, pupil: 2.5, max: 1.8 },
      { x: 6.5, y: -58, r: 0, pupil: 2.5, max: 1.8 },
    ],
    body: (hatch) => (
      <>
        <path d="M-15 -6 L-3 -6 C-3 8 -5 20 -6 30 L-15 30 C-15 18 -16 6 -15 -6 Z" />
        <path d="M3 -6 L15 -6 C17 6 19 16 22 27 L12 30 C10 18 6 6 3 -6 Z" />
        <path d="M3 -6 L15 -6 C17 6 19 16 22 27 L12 30 C10 18 6 6 3 -6 Z" fill={hatch} stroke="none" />
        <path className="k" d="M-17 30 C-20 34 -20 40 -14 41 L-2 41 C2 40 0 34 -5 30 Z" />
        <path className="k" d="M11 29 C8 34 10 40 16 40 L26 38 C29 36 27 30 22 27 Z" />
        <path d="M-20 -4 C-22 -20 -18 -38 -10 -44 L10 -44 C18 -38 22 -20 20 -4 Z" />
        <path className="n thick" d="M-19.5 -14 L19.5 -14 M-18.5 -26 L18.5 -26 M-14 -36 L14 -36" />
        <path className="n" d="M-18 -36 C-28 -28 -30 -14 -26 -5" />
        <circle cx="-26" cy="-3" r="4" />
        <path className="n" d="M18 -36 C27 -30 30 -18 28 -7" />
        <circle cx="28" cy="-4" r="4" />
        <circle cx="-17" cy="-58" r="4" />
        <circle cx="17" cy="-58" r="4" />
        <circle cx="0" cy="-60" r="17" />
        <path className="n thin" d="M-11 -52 l2 -2 M-8 -52 l2 -2 M8 -52 l2 -2 M11 -52 l2 -2" />
        <path className="n" d="M-5 -50 C-2 -47 2 -47 5 -50" />
        <path d="M-15 -70 C-14 -87 14 -87 15 -70 Z" />
        <path d="M-27 -68 C-16 -75 16 -75 27 -68 C18 -63 -18 -63 -27 -68 Z" />
        <path className="n thick" d="M-14.5 -74 C-6 -77 6 -77 14.5 -74" />
      </>
    ),
  },
  bird: {
    k: 1.22,
    box: { l: -34, r: 30, t: -62, b: 2 },
    seat: 'top',
    eyes: [
      { x: 3, y: -30, r: 4.6, pupil: 2.3, max: 2 },
      { x: 12, y: -31, r: 4.6, pupil: 2.3, max: 2 },
    ],
    idle: 'dcf-peck',
    body: (hatch) => (
      <>
        <path className="n" d="M-5 0 L-5 -7 M-9 0 L-1 0 M5 0 L5 -7 M1 0 L9 0" />
        <path d="M-17 -16 C-26 -18 -31 -14 -33 -9 C-26 -10 -20 -8 -15 -10 Z" />
        <path d="M-18 -14 C-20 -30 -10 -40 2 -40 C16 -40 22 -28 20 -16 C18 -6 8 -4 0 -4 C-10 -4 -17 -8 -18 -14 Z" />
        <path d="M-11 -25 C-3 -26 1 -18 -3 -13 C-9 -12 -15 -17 -11 -25 Z" fill={hatch} />
        <path className="o" d="M19 -30 L29 -27 L19 -23 Z" />
        <path className="a" d="M-3 -38 L4 -59 L12 -37 Z" />
        <path className="n thin" d="M-1 -44 L10 -46 M1 -51 L8 -52" />
        <circle cx="4" cy="-60" r="2.8" />
      </>
    ),
  },
  cat: {
    k: 1.06,
    box: { l: -30, r: 52, t: -110, b: 4 },
    seat: 'front',
    eyes: [{ x: 10, y: -76, r: 6, pupil: 2.8, max: 2.6 }],
    body: (hatch) => (
      <>
        <ellipse className="dcf-shadow" cx="4" cy="2" rx="32" ry="4" />
        <g className="dcf-tail">
          <path d="M18 -4 C42 -4 52 -24 46 -44 C44 -51 36 -53 34 -46 C40 -30 34 -16 16 -14 Z" />
          <path className="n thin" d="M40 -16 l5 4 M45 -30 l6 1 M43 -42 l6 -3" />
        </g>
        <path d="M-22 0 C-28 -18 -24 -42 -14 -52 L14 -52 C24 -42 28 -18 22 0 C10 3 -10 3 -22 0 Z" />
        <path d="M14 -46 C24 -36 26 -16 22 0 C18 1 14 2 12 2 C16 -14 16 -32 10 -46 Z" fill={hatch} stroke="none" />
        <path className="n" d="M-8 -30 L-9 -1 M8 -30 L9 -1" />
        <path d="M-16 1 C-16 -5 -3 -5 -3 1 Z M3 1 C3 -5 16 -5 16 1 Z" />
        <path className="a" d="M-18 -55 C-6 -49 6 -49 18 -55 L17 -46 C6 -40 -6 -40 -17 -46 Z" />
        <path className="a" d="M9 -45 L18 -32 L6 -37 Z" />
        <path d="M-22 -86 L-25 -107 L-7 -96 Z" />
        <path d="M8 -96 L23 -108 L22 -86 Z" />
        <path className="n thin" d="M-20 -92 L-21 -101 M18 -101 L18 -92" />
        <path d="M-26 -70 C-28 -88 -16 -98 0 -98 C16 -98 28 -88 26 -70 C24 -56 12 -50 0 -50 C-12 -50 -24 -56 -26 -70 Z" />
        <path className="n thin" d="M-4 -97 L-3 -90 M3 -97 L3 -91" />
        <path className="n" d="M-26 -80 C-14 -83 4 -87 25 -93" />
        <ellipse className="k" cx="-10" cy="-76" rx="7.5" ry="6.5" />
        <path className="k" d="M-2.5 -68 L2.5 -68 L0 -64.5 Z" />
        <path className="n" d="M0 -64.5 C-1 -60.5 -5 -60.5 -6 -62.5 M0 -64.5 C1 -60.5 5 -60.5 6 -62.5" />
        <path className="n thin" d="M-15 -66 L-29 -68 M-15 -63 L-28 -59 M15 -66 L29 -68 M15 -63 L28 -59" />
      </>
    ),
  },
  ghost: {
    k: 1.3,
    box: { l: -26, r: 26, t: -70, b: 0 },
    seat: 'behind',
    eyes: [
      { x: -8, y: -44, r: 6.5, pupil: 3.2, max: 3 },
      { x: 9, y: -44, r: 6.5, pupil: 3.2, max: 3 },
    ],
    idle: 'dcf-bob',
    body: (hatch) => (
      <>
        <path d="M-23 -14 L-23 -40 C-23 -59 -12 -67 0 -67 C12 -67 23 -59 23 -40 L23 -14 C12 -10 -12 -10 -23 -14 Z" />
        <path d="M13 -61 C21 -54 23 -46 23 -36 L23 -15 L15 -13 L15 -36 C15 -46 15 -54 13 -61 Z" fill={hatch} stroke="none" />
        <path className="n thin" d="M-16 -56 C-12 -61 -6 -63 -2 -63" />
        <path className="k" d="M-5 -33 C-3 -27 4 -27 6 -33 Z" />
        <path className="n thin" d="M-17 -35 l3 -2 M-14 -34 l3 -2 M14 -35 l3 -2 M17 -34 l3 -2" />
      </>
    ),
    front: () => (
      <>
        <path d="M-25 -32 C-27 -38 -21 -42 -17 -38 C-15 -42 -10 -41 -10 -36 L-11 -30 C-15 -28 -22 -28 -25 -32 Z" />
        <path d="M25 -32 C27 -38 21 -42 17 -38 C15 -42 10 -41 10 -36 L11 -30 C15 -28 22 -28 25 -32 Z" />
      </>
    ),
  },
  mushroom: {
    k: 1.12,
    box: { l: -27, r: 27, t: -56, b: 4 },
    seat: 'front',
    eyes: [
      { x: -4.5, y: -16, r: 0, pupil: 1.9, max: 1.3 },
      { x: 4.5, y: -16, r: 0, pupil: 1.9, max: 1.3 },
    ],
    idle: 'dcf-sway',
    body: (hatch) => (
      <>
        <ellipse className="dcf-shadow" cx="0" cy="2" rx="18" ry="3" />
        <path className="n" d="M-10 -15 L-17 -9 M10 -15 L17 -11" />
        <path d="M-10 0 C-12 -10 -10 -22 -8 -28 L8 -28 C10 -22 12 -10 10 0 C4 2 -4 2 -10 0 Z" />
        <path d="M5 -27 C9 -20 11 -10 10 0 C8 1 6 1.5 4 1.5 C6 -8 6 -18 2 -27 Z" fill={hatch} stroke="none" />
        <path className="r" d="M-25 -28 C-27 -45 -12 -55 0 -55 C12 -55 27 -45 25 -28 C14 -23 -14 -23 -25 -28 Z" />
        <circle cx="-12" cy="-40" r="4.2" />
        <circle cx="6" cy="-46" r="3.4" />
        <circle cx="15" cy="-34" r="3" />
        <circle cx="-2" cy="-33" r="2.4" />
        <path className="n" d="M-2 -10 C-1 -8 1 -8 2 -10" />
      </>
    ),
  },
};

// ---- medida da palavra ----------------------------------------------------------------
// No servidor (e na hidratação) a palavra é diagramada por estimativa; no navegador, pela
// fonte de verdade, medida num canvas. As duas ficam em cache para o useSyncExternalStore
// receber sempre o mesmo objeto enquanto nada mudou.

type Metrics = { advances: number[]; cap: number };

const FONT_SIZE = 200;
const DEFAULT_FONT = '"Arial Black", "Inter Display", Inter, "Helvetica Neue", Helvetica, Arial, sans-serif';
const DEFAULT_SERIF = '"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif';

const estimativas = new Map<string, Metrics>();
const medidas = new Map<string, Metrics>();

function estimate(word: string): Metrics {
  let m = estimativas.get(word);
  if (!m) {
    m = {
      advances: Array.from(word).map((c) => (c === ' ' ? 0.3 : /[IJ1]/.test(c) ? 0.42 : /[MW]/.test(c) ? 0.98 : 0.76) * FONT_SIZE),
      cap: 0.73 * FONT_SIZE,
    };
    estimativas.set(word, m);
  }
  return m;
}

function measure(word: string, family: string): Metrics {
  const chave = family + '\u0000' + word;
  const pronta = medidas.get(chave);
  if (pronta) return pronta;
  const ctx = document.createElement('canvas').getContext('2d');
  if (!ctx) return estimate(word);
  ctx.font = '900 ' + FONT_SIZE + 'px ' + family;
  const chars = Array.from(word);
  const advances: number[] = [];
  let prev = 0;
  for (let i = 0; i < chars.length; i++) {
    const wNow = ctx.measureText(chars.slice(0, i + 1).join('')).width;
    advances.push(wNow - prev);
    prev = wNow;
  }
  const m = ctx.measureText(word.replace(/\s/g, '') || 'H');
  const medida = { advances, cap: m.actualBoundingBoxAscent > 0 ? m.actualBoundingBoxAscent : 0.73 * FONT_SIZE };
  medidas.set(chave, medida);
  return medida;
}

/** Mede de novo quando uma fonte termina de carregar. */
function assinarFontes(avisar: () => void) {
  const fontes = document.fonts;
  if (!fontes) return () => {};
  let viva = true;
  const mudou = () => {
    if (!viva) return;
    medidas.clear();
    avisar();
  };
  fontes.ready.then(mudou);
  fontes.addEventListener('loadingdone', mudou);
  return () => {
    viva = false;
    fontes.removeEventListener('loadingdone', mudou);
  };
}

const CONSULTA_MOVIMENTO = '(prefers-reduced-motion: reduce)';
function assinarMovimento(avisar: () => void) {
  const mq = window.matchMedia(CONSULTA_MOVIMENTO);
  mq.addEventListener('change', avisar);
  return () => mq.removeEventListener('change', avisar);
}
const movimentoReduzido = () => window.matchMedia(CONSULTA_MOVIMENTO).matches;
const semPreferencia = () => false;

// ---- simulação ------------------------------------------------------------------------

type Olhar = { tx: number; ty: number; next: number; blinkAt: number; blink: number; o: { x: number; y: number }[] };
type Sim = {
  floaters: Floater[];
  w: number;
  h: number;
  px: number;
  py: number;
  inside: boolean;
  visible: boolean;
  gaze: Olhar[];
  seed: number;
  start: number;
};

/** Escreve a posição de cada rabisco direto no DOM (sem re-renderizar a cada quadro). */
function paintDoodles(s: Sim, els: (HTMLDivElement | null)[]) {
  const k = clamp(s.w / 1100, 0.5, 1);
  for (let i = 0; i < s.floaters.length; i++) {
    const el = els[i];
    const f = s.floaters[i];
    if (!el || !f) continue;
    let sc = k;
    let op = 1;
    if (f.pop > 0) {
      const age = 1.4 - f.pop;
      sc = k * (1 + Math.min(1, age / 0.3) * 0.7);
      op = Math.max(0, 1 - age / 0.3);
    }
    el.style.transform = 'translate3d(' + f.x.toFixed(1) + 'px,' + f.y.toFixed(1) + 'px,0) rotate(' + f.rot.toFixed(1) + 'deg) scale(' + sc.toFixed(3) + ')';
    el.style.opacity = String(op);
  }
}

/** Link interno (/...) navega pelo Next; âncora e externo viram <a> comum; sem href, só texto. */
function ItemDoRodape({ link, className }: { link: FooterLink; className?: string }) {
  if (!link.href) return <span className={className}>{link.label}</span>;
  const conteudo = (
    <>
      <span>{link.label}</span>
      <svg className="dcf-squiggle" viewBox="0 0 100 8" preserveAspectRatio="none" aria-hidden="true">
        <path pathLength={1} d="M1 5 C10 1 16 7 25 4 S40 1 50 4 S66 7 75 4 S90 1 99 4" />
      </svg>
    </>
  );
  return link.href.startsWith('/') ? (
    <Link className={className} href={link.href}>
      {conteudo}
    </Link>
  ) : (
    <a className={className} href={link.href}>
      {conteudo}
    </a>
  );
}

export function RodapeLastro({
  wordmark = 'LASTRO',
  brand = 'Lastro',
  blurb = 'O Bater PDF do Bate Lastro rodando neste computador. Bata termo e lastro campo a campo e devolva tudo pelo Inserir Resultado.',
  tagline = 'Se o Bate Lastro cair, o lastro continua sendo batido.',
  columns = COLUNAS,
  actions = ACOES,
  copyright = 'Denver Contábil · Bate PDF, a contingência do Bate Lastro',
  legal = [{ label: 'Uso interno' }, { label: 'Os dados ficam neste computador' }],
  socials = [],
  backToTop = false,
  crew = TURMA,
  doodles = RABISCOS,
  doodleCount = 12,
  palette,
  fontFamily = DEFAULT_FONT,
  serifFamily = DEFAULT_SERIF,
  tracking = -0.02,
  interactive = true,
  height = '760px',
  className,
}: RodapeLastroProps) {
  const uid = React.useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const word = wordmark.toUpperCase();
  const chars = React.useMemo(() => Array.from(word), [word]);
  const colors = { ...CORES, ...(palette || {}) };

  const rootRef = React.useRef<HTMLElement | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const worldRef = React.useRef<HTMLDivElement | null>(null);
  const crewLayerRefs = React.useRef<(SVGGElement | null)[]>([]);
  const eyeRefs = React.useRef<{ blink: SVGGElement | null; pupil: SVGGElement | null }[][]>([]);
  const doodleRefs = React.useRef<(HTMLDivElement | null)[]>([]);

  const metrics = React.useSyncExternalStore(assinarFontes, () => measure(word, fontFamily), () => estimate(word));
  const reduced = React.useSyncExternalStore(assinarMovimento, movimentoReduzido, semPreferencia);
  const [play, setPlay] = React.useState(false);
  const [talking, setTalking] = React.useState(-1);
  const [hopping, setHopping] = React.useState(-1);
  const talkTimer = React.useRef(0);
  // O baixista (Baixista.tsx): reações da turma por índice e o "já pode começar".
  const [reacoes, setReacoes] = React.useState<Record<number, string>>({});
  const [iniciarBx, setIniciarBx] = React.useState(false);
  const montadoEm = React.useRef(0);
  // Amasso das letras (o baixista amassa a A): invólucro só para isso, sem animação CSS,
  // para não brigar com o carimbo da entrada nem com o tremido do hover.
  const amassoRefs = React.useRef<(SVGGElement | null)[]>([]);
  const amassoA = React.useRef({ sx: 1, sy: 1, cx: 0 });

  const layout = React.useMemo(() => layoutWord(metrics.advances, tracking, FONT_SIZE), [metrics, tracking]);
  const cap = metrics.cap;

  const placed = React.useMemo(
    () =>
      crew
        .map((m, i) => {
          const art = ART[m.kind];
          if (!art || !chars.length) return null;
          const li = clamp(Math.floor(m.letter) || 0, 0, chars.length - 1);
          const scale = (cap / 144) * art.k * (m.scale ?? 1);
          const seat = m.seat || art.seat;
          const p = seatPoint(seat, layout.x[li], layout.w[li], cap, m.offset ?? 0, scale);
          return { i, m, art, seat, scale, ...p, flip: m.flip ? -1 : 1 };
        })
        .filter((p) => p !== null),
    [crew, chars.length, layout, cap],
  );

  // O viewBox abraça a palavra, a turma e o chão.
  const view = React.useMemo(() => {
    let l = 0;
    let r = layout.width;
    let t = -cap;
    let b = 30;
    for (const p of placed) {
      const bx = p.flip > 0 ? [p.art.box.l, p.art.box.r] : [-p.art.box.r, -p.art.box.l];
      l = Math.min(l, p.x + bx[0] * p.scale);
      r = Math.max(r, p.x + bx[1] * p.scale);
      t = Math.min(t, p.y + p.art.box.t * p.scale);
      b = Math.max(b, p.y + p.art.box.b * p.scale);
    }
    const pad = 24;
    return { x: l - pad, y: t - pad, w: r - l + pad * 2, h: b - t + pad * 2 };
  }, [layout, placed, cap]);

  // O caminho do baixista sai das letras medidas: O, R, T, S e por fim a A (onde senta).
  const roteiroBx = React.useMemo<RoteiroBaixista | null>(() => {
    const idx = ['O', 'R', 'T', 'S', 'A'].map((c) => chars.indexOf(c));
    if (idx.some((i) => i < 0) || !cap) return null;
    const escala = (cap / 144) * 0.95;
    const offsets = [0.12, -0.12, 0.34, -0.22, 0.02];
    const apoios = idx.map((i, k) => seatPoint('top', layout.x[i], layout.w[i], cap, offsets[k], escala));
    const menino = placed.find((p) => p.m.kind === 'kid' && p.m.letter === idx[2] && p.seat === 'top');
    const topoMenino = menino ? menino.y + menino.art.box.t * menino.scale : NaN;
    const direita = view.x + view.w;
    return {
      escala,
      cap,
      entrada: { x: direita + 70 * escala, y: 0 },
      parada: { x: direita + 4 * escala, y: 0 },
      apoios,
      obstaculos: [NaN, NaN, topoMenino, NaN],
    };
  }, [chars, cap, layout, placed, view]);

  const indiceA = chars.indexOf('A');
  const pintarAmassoA = React.useCallback(() => {
    const el = amassoRefs.current[indiceA];
    if (!el) return;
    const { sx, sy, cx } = amassoA.current;
    if (sx === 1 && sy === 1) el.removeAttribute('transform');
    else el.setAttribute('transform', 'translate(' + cx.toFixed(2) + ' 0) scale(' + sx.toFixed(4) + ' ' + sy.toFixed(4) + ') translate(' + (-cx).toFixed(2) + ' 0)');
  }, [indiceA]);
  // O centro da A muda quando a palavra é diagramada de novo (fontes, largura): reaplica.
  React.useEffect(() => {
    if (indiceA < 0) return;
    amassoA.current.cx = layout.x[indiceA] + layout.w[indiceA] / 2;
    pintarAmassoA();
  }, [layout, indiceA, pintarAmassoA]);
  const amassarA = React.useCallback(
    (sx: number, sy: number) => {
      amassoA.current = { ...amassoA.current, sx, sy };
      pintarAmassoA();
    },
    [pintarAmassoA],
  );

  const reagirBx = React.useCallback(
    (r: ReacaoBx) => {
      const idx = { T: chars.indexOf('T'), S: chars.indexOf('S'), A: chars.indexOf('A') };
      const quem = (kind: CrewKind, letra: number) => placed.find((p) => p.m.kind === kind && p.m.letter === letra)?.i;
      const marcar = (i: number | undefined, cls: string | null) => {
        if (i === undefined) return;
        setReacoes((atual) => {
          const novo = { ...atual };
          if (cls) novo[i] = cls;
          else delete novo[i];
          return novo;
        });
      };
      if (r === 'agacha') {
        const i = quem('kid', idx.T);
        marcar(i, 'is-agacha');
        window.setTimeout(() => marcar(i, null), 1150);
      } else if (r === 'afunda') marcar(quem('ghost', idx.S), 'is-afunda');
      else if (r === 'volta') marcar(quem('ghost', idx.S), null);
      else if (r === 'voa') {
        const i = quem('bird', idx.A);
        if (reduced) marcar(i, 'is-voou');
        else {
          marcar(i, 'is-voa');
          window.setTimeout(() => marcar(i, 'is-voou'), 2150);
        }
      }
    },
    [chars, placed, reduced],
  );

  const words = tagline.split(/\s+/).filter(Boolean);
  const tl = timeline(chars.length, placed.length, words.length, actions.length);
  const inicioRabiscos = tl.doodles;

  const ground = React.useMemo(() => {
    const x0 = view.x + 6;
    const x1 = view.x + view.w - 6;
    let d = 'M' + x0.toFixed(1) + ' 6';
    const n = 14;
    for (let k = 1; k <= n; k++) {
      const x = x0 + ((x1 - x0) * k) / n;
      d += ' Q' + (x - (x1 - x0) / n / 2).toFixed(1) + ' ' + (6 + (hash(k * 3.1) - 0.5) * 5).toFixed(1) + ' ' + x.toFixed(1) + ' ' + (6 + (hash(k * 7.7) - 0.5) * 2).toFixed(1);
    }
    let tufts = '';
    for (let k = 0; k < 22; k++) {
      const x = x0 + 20 + hash(k * 11.3) * (x1 - x0 - 40);
      const s = 0.7 + hash(k * 5.9) * 0.6;
      tufts += 'M' + x.toFixed(1) + ' 6 l' + (2 * s).toFixed(1) + ' ' + (-9 * s).toFixed(1) + ' M' + (x + 3 * s).toFixed(1) + ' 6 l' + (1 * s).toFixed(1) + ' ' + (-12 * s).toFixed(1) + ' M' + (x + 6 * s).toFixed(1) + ' 6 l' + (-1 * s).toFixed(1) + ' ' + (-7 * s).toFixed(1) + ' ';
    }
    const pebbles = Array.from({ length: 9 }, (_, k) => ({ x: x0 + 40 + hash(k * 17.1) * (x1 - x0 - 80), y: 14 + hash(k * 2.3) * 8, r: 2 + hash(k * 9.4) * 2.6 }));
    return { d, tufts, pebbles };
  }, [view]);

  // ---- rabiscos ----
  const doodleList = React.useMemo(() => {
    const n = doodles.length ? clamp(Math.floor(doodleCount) || 0, 0, 40) : 0;
    return Array.from({ length: n }, (_, k) => ({ kind: doodles[k % doodles.length], size: 22 + hash(k * 4.7) * 14 }));
  }, [doodles, doodleCount]);

  const sim = React.useRef<Sim>({ floaters: [], w: 0, h: 0, px: NaN, py: NaN, inside: false, visible: false, gaze: [], seed: 1, start: 0 });

  // Espalha os rabiscos quando o mundo ganha tamanho; mantém a posição relativa ao redimensionar.
  React.useLayoutEffect(() => {
    const el = worldRef.current;
    if (!el) return;
    const s = sim.current;
    const els = doodleRefs.current;
    const size = () => {
      const r = el.getBoundingClientRect();
      const ow = s.w;
      const oh = s.h;
      s.w = r.width;
      s.h = r.height;
      if (s.floaters.length !== doodleList.length || !ow) {
        s.floaters = doodleList.map((_, k) => ({
          x: (0.04 + 0.92 * ((k + hash(k * 9.1) * 0.8) / Math.max(1, doodleList.length))) * r.width,
          y: (0.02 + hash(k * 3.3) * 0.56) * r.height,
          vx: 0,
          vy: 0,
          rot: (hash(k * 1.7) - 0.5) * 50,
          vr: (hash(k * 6.1) - 0.5) * 30,
          fall: 9 + hash(k * 2.9) * 16,
          phase: hash(k * 8.3) * Math.PI * 2,
          pop: 0,
        }));
      } else if (ow && oh) {
        for (const f of s.floaters) {
          f.x *= r.width / ow;
          f.y *= r.height / oh;
        }
      }
      paintDoodles(s, els);
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(el);
    return () => ro.disconnect();
  }, [doodleList]);

  // ---- o storyboard começa quando o rodapé entra na tela; o laço dorme fora dela ----
  React.useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const s = sim.current;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          s.visible = e.isIntersecting;
          if (e.isIntersecting && e.intersectionRatio > 0.12) setPlay(true);
        }
      },
      { threshold: [0, 0.12, 0.3] },
    );
    io.observe(root);
    return () => io.disconnect();
  }, []);

  React.useEffect(() => {
    if (play && !sim.current.start) sim.current.start = performance.now();
  }, [play]);

  // O baixista entra 10 s depois de a página abrir, sem atropelar a animação da logo: espera
  // o storyboard terminar e o rodapé estar na tela.
  const totalStoryboard = tl.total;
  React.useEffect(() => {
    if (!montadoEm.current) montadoEm.current = performance.now();
    if (!roteiroBx || iniciarBx) return;
    const id = window.setInterval(() => {
      const s = sim.current;
      const agora = performance.now();
      const logoPronta = reduced || (s.start > 0 && agora - s.start >= totalStoryboard);
      if (agora - montadoEm.current >= 10_000 && logoPronta && s.visible && !document.hidden) {
        setIniciarBx(true);
        window.clearInterval(id);
      }
    }, 400);
    return () => window.clearInterval(id);
  }, [roteiroBx, iniciarBx, reduced, totalStoryboard]);

  // ---- o laço vivo: olhos, piscadas, rabiscos e a "fervura" das linhas ----
  React.useEffect(() => {
    const s = sim.current;
    const eyeEls = eyeRefs.current;
    const layers = crewLayerRefs.current;
    const els = doodleRefs.current;
    let raf = 0;
    let last = performance.now();
    let boilAt = 0;
    let boil = 0;
    const rand = () => {
      s.seed = (s.seed * 16807) % 2147483647;
      return s.seed / 2147483647;
    };
    const svgPoint = (svg: SVGSVGElement, cx: number, cy: number) => {
      const m = svg.getScreenCTM();
      if (!m) return null;
      const inv = m.inverse();
      return { x: inv.a * cx + inv.c * cy + inv.e, y: inv.b * cx + inv.d * cy + inv.f };
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (!s.visible || document.hidden) {
        last = now;
        return;
      }
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const t = now / 1000;
      const svg = svgRef.current;
      const world = worldRef.current;

      // olhos
      const target = svg && s.inside && interactive ? svgPoint(svg, s.px, s.py) : null;
      for (let c = 0; c < placed.length; c++) {
        const p = placed[c];
        const g = (s.gaze[c] ||= { tx: 0, ty: 0, next: 0, blinkAt: t + 1 + hash(c * 3.7) * 3, blink: 0, o: [] });
        if (!target && t > g.next) {
          // parado: olha para algum lugar, de vez em quando para um vizinho
          const other = placed[(c + 1 + Math.floor(rand() * Math.max(1, placed.length - 1))) % placed.length];
          if (other && rand() < 0.45) {
            g.tx = other.x;
            g.ty = other.y - 60 * other.scale;
          } else {
            g.tx = p.x + (rand() - 0.5) * 900;
            g.ty = p.y - 80 * p.scale + (rand() - 0.5) * 500;
          }
          g.next = t + 1.4 + rand() * 2.6;
        }
        if (t > g.blinkAt) {
          g.blink = 0.16;
          g.blinkAt = t + 2.2 + rand() * 4;
        }
        g.blink = Math.max(0, g.blink - dt);
        const lid = g.blink > 0 ? 0.12 + (Math.abs(g.blink - 0.08) / 0.08) * 0.88 : 1;
        const eyes = eyeEls[p.i] || [];
        for (let e = 0; e < p.art.eyes.length; e++) {
          const eye = p.art.eyes[e];
          const ref = eyes[e];
          if (!ref) continue;
          const ex = p.x + eye.x * p.scale * p.flip;
          const ey = p.y + eye.y * p.scale;
          const o = lookAt(ex, ey, target ? target.x : g.tx, target ? target.y : g.ty, eye.max, 220);
          const prev = g.o[e] || { x: 0, y: 0 };
          const ease = Math.min(1, dt * (target ? 14 : 6));
          const nx = prev.x + (o.x * p.flip - prev.x) * ease;
          const ny = prev.y + (o.y - prev.y) * ease;
          g.o[e] = { x: nx, y: ny };
          if (ref.pupil) ref.pupil.setAttribute('transform', 'translate(' + nx.toFixed(2) + ' ' + ny.toFixed(2) + ')');
          if (ref.blink) ref.blink.setAttribute('transform', 'translate(0 ' + (eye.y * (1 - lid)).toFixed(2) + ') scale(1 ' + lid.toFixed(3) + ')');
        }
      }

      // rabiscos
      if (world && s.floaters.length) {
        const started = play && s.start ? now - s.start > inicioRabiscos || reduced : false;
        if (started) {
          const r = world.getBoundingClientRect();
          const px = s.inside && interactive ? s.px - r.left : NaN;
          const py = s.inside && interactive ? s.py - r.top : NaN;
          if (!reduced) for (const f of s.floaters) stepFloater(f, dt, t, s.w, s.h, px, py, 110, rand);
          paintDoodles(s, els);
        }
      }

      // fervura das linhas: três versões "desenhadas à mão" trocadas a 8 quadros por segundo
      if (!reduced && now - boilAt > 125) {
        boilAt = now;
        boil = (boil + 1) % 3;
        const f = 'url(#' + uid + '-boil' + boil + ')';
        for (const el of layers) if (el) el.setAttribute('filter', f);
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [placed, play, reduced, interactive, uid, inicioRabiscos]);

  React.useEffect(() => {
    const timer = talkTimer;
    return () => window.clearTimeout(timer.current);
  }, []);

  const onPointerMove = (e: React.PointerEvent) => {
    const s = sim.current;
    s.px = e.clientX;
    s.py = e.clientY;
    s.inside = true;
  };
  const onPointerLeave = () => {
    sim.current.inside = false;
  };

  const poke = (c: number) => {
    if (!interactive) return;
    setTalking(c);
    setHopping(-1);
    requestAnimationFrame(() => setHopping(c));
    window.clearTimeout(talkTimer.current);
    talkTimer.current = window.setTimeout(() => {
      setTalking(-1);
      setHopping(-1);
    }, 2600);
  };

  const popDoodle = (k: number) => {
    if (!interactive) return;
    const f = sim.current.floaters[k];
    if (f && f.pop <= 0) {
      f.pop = 1.4;
      paintDoodles(sim.current, doodleRefs.current);
    }
  };

  const toTop = () => window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' });

  const hatch = 'url(#' + uid + '-hatch)';
  const vars = {
    '--dcf-bg': colors.background,
    '--dcf-ink': colors.ink,
    '--dcf-accent': colors.accent,
    '--dcf-serif': serifFamily,
    '--dcf-display': fontFamily,
    minHeight: height,
  } as React.CSSProperties;

  const pct = (v: number, base: number, span: number) => (((v - base) / span) * 100).toFixed(3) + '%';

  const renderCrew = (p: (typeof placed)[number], part: 'body' | 'front') => (
    <g key={p.i + part} transform={'translate(' + p.x.toFixed(2) + ' ' + p.y.toFixed(2) + ') scale(' + (p.scale * p.flip).toFixed(4) + ' ' + p.scale.toFixed(4) + ')'}>
      <g className={'dcf-react' + (reacoes[p.i] ? ' ' + reacoes[p.i] : '')}>
      <g className={'dcf-arrive dcf-arrive-' + p.seat} style={{ '--d': tl.member(p.i) + 'ms' } as React.CSSProperties}>
        <g className={'dcf-hopper' + (hopping === p.i ? ' is-hop' : '')}>
          <g className={'dcf-art' + (p.art.idle ? ' ' + p.art.idle : '')} style={{ '--i': p.i } as React.CSSProperties}>
            {part === 'body' ? (
              <>
                {p.m.kind === 'bird' && <AsasDoPassarinho />}
                {p.art.body(hatch)}
                {p.art.eyes.map((eye, e) => (
                  <g
                    key={e}
                    ref={(el) => {
                      (eyeRefs.current[p.i] ||= [])[e] = { ...(eyeRefs.current[p.i]?.[e] || { pupil: null }), blink: el };
                    }}
                  >
                    {eye.r > 0 && <circle cx={eye.x} cy={eye.y} r={eye.r} />}
                    <g
                      ref={(el) => {
                        (eyeRefs.current[p.i] ||= [])[e] = { ...(eyeRefs.current[p.i]?.[e] || { blink: null }), pupil: el };
                      }}
                    >
                      <circle className="k" cx={eye.x} cy={eye.y} r={eye.pupil} />
                      <circle className="dcf-glint" cx={eye.x + eye.pupil * 0.35} cy={eye.y - eye.pupil * 0.4} r={eye.pupil * 0.32} />
                    </g>
                  </g>
                ))}
              </>
            ) : (
              p.art.front?.()
            )}
          </g>
        </g>
      </g>
      </g>
    </g>
  );

  return (
    <footer
      ref={rootRef}
      className={'dcf' + (className ? ' ' + className : '')}
      data-play={play || reduced ? '1' : '0'}
      data-interactive={interactive ? '1' : '0'}
      style={vars}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerMove}
      onPointerLeave={onPointerLeave}
    >
      <style>{CSS + CSS_BAIXISTA}</style>

      <div className="dcf-top dcf-rise" style={{ '--d': '0ms' } as React.CSSProperties}>
        <div className="dcf-brand">
          <span className="dcf-logo" aria-hidden="true">
            <DesenhoLogoLastro />
          </span>
          <span className="dcf-brandname">{brand}</span>
        </div>
        {blurb && <p className="dcf-blurb">{blurb}</p>}
        {columns.length > 0 && (
          <nav className="dcf-cols" aria-label="Rodapé">
            {columns.map((col) => (
              <div className="dcf-col" key={col.title}>
                <h3 className="dcf-coltitle">{col.title}</h3>
                <ul>
                  {col.links.map((l) => (
                    <li key={l.label}>
                      <ItemDoRodape link={l} className="dcf-link" />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        )}
      </div>

      <div className="dcf-world" ref={worldRef}>
        <div className="dcf-stage">
          <h2 className="dcf-sr">{wordmark}</h2>
          <svg
            ref={svgRef}
            className="dcf-svg"
            viewBox={view.x.toFixed(1) + ' ' + view.y.toFixed(1) + ' ' + view.w.toFixed(1) + ' ' + view.h.toFixed(1)}
            role="group"
            aria-label={wordmark + ' — conheça a turma'}
          >
            <defs>
              <pattern id={uid + '-hatch'} width="4.6" height="4.6" patternUnits="userSpaceOnUse" patternTransform="rotate(38)">
                <line x1="0" y1="0" x2="0" y2="4.6" style={{ stroke: 'var(--dcf-ink)' }} strokeWidth="1.25" />
              </pattern>
              {[0, 1, 2].map((k) => (
                <filter key={k} id={uid + '-boil' + k} x="-10%" y="-10%" width="120%" height="120%">
                  <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed={k * 7 + 3} result="n" />
                  <feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G" />
                </filter>
              ))}
              <filter id={uid + '-ink'} x="-4%" y="-6%" width="108%" height="112%">
                <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="3" seed="11" result="edge" />
                <feDisplacementMap in="SourceGraphic" in2="edge" scale="5" xChannelSelector="R" yChannelSelector="G" result="rough" />
                <feTurbulence type="fractalNoise" baseFrequency="0.018 0.32" numOctaves="2" seed="4" result="streak" />
                <feColorMatrix in="streak" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -16 5.6" result="streakA" />
                <feTurbulence type="fractalNoise" baseFrequency="0.7" numOctaves="1" seed="9" result="speck" />
                <feColorMatrix in="speck" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -24 7.0" result="speckA" />
                <feComposite in="streakA" in2="speckA" operator="arithmetic" k1="0" k2="1" k3="1" k4="0" result="holes" />
                <feComposite in="rough" in2="holes" operator="out" />
              </filter>
            </defs>

            <g ref={(el) => void (crewLayerRefs.current[0] = el)}>
              <g className="dcf-ground">
                <path className="dcf-draw" pathLength={1} d={ground.d} style={{ '--d': tl.ground + 'ms' } as React.CSSProperties} />
                <path className="dcf-tufts dcf-fade" d={ground.tufts} style={{ '--d': tl.ground + 500 + 'ms' } as React.CSSProperties} />
                {ground.pebbles.map((pb, k) => (
                  <ellipse key={k} className="dcf-pebble dcf-fade" cx={pb.x} cy={pb.y} rx={pb.r * 1.5} ry={pb.r} style={{ '--d': tl.ground + 600 + 'ms' } as React.CSSProperties} />
                ))}
              </g>
              {placed.filter((p) => p.seat === 'behind').map((p) => renderCrew(p, 'body'))}
            </g>

            {chars.map((c, i) =>
              c === ' ' ? null : (
                <g key={i} className="dcf-letter" style={{ '--d': tl.letter(i) + 'ms', '--r': ((hash(i * 2.3) - 0.5) * 9).toFixed(2) + 'deg' } as React.CSSProperties}>
                  <g className="dcf-glyph">
                    <g ref={(el) => void (amassoRefs.current[i] = el)}>
                      <text x={layout.x[i]} y={0} fontSize={FONT_SIZE} fontWeight={900} style={{ fontFamily }} filter={'url(#' + uid + '-ink)'}>
                        {c}
                      </text>
                    </g>
                  </g>
                  <path
                    className="dcf-dust"
                    d={'M' + (layout.x[i] - 6) + ' -6 l-16 -6 M' + (layout.x[i] - 4) + ' -16 l-12 -12 M' + (layout.x[i] + layout.w[i] + 6) + ' -6 l16 -6 M' + (layout.x[i] + layout.w[i] + 4) + ' -16 l12 -12'}
                  />
                </g>
              ),
            )}

            <g ref={(el) => void (crewLayerRefs.current[1] = el)}>
              {placed.filter((p) => p.seat === 'behind').map((p) => renderCrew(p, 'front'))}
              {placed.filter((p) => p.seat !== 'behind').map((p) => renderCrew(p, 'body'))}
              {roteiroBx && <Baixista roteiro={roteiroBx} iniciar={iniciarBx} reduzido={reduced} hatch={hatch} onReacao={reagirBx} amassarA={amassarA} />}
            </g>

            {interactive &&
              placed.filter((p) => !String(reacoes[p.i] ?? '').startsWith('is-vo')).map((p) => {
                const bx = p.flip > 0 ? [p.art.box.l, p.art.box.r] : [-p.art.box.r, -p.art.box.l];
                const top = p.art.box.t;
                const bottom = p.seat === 'behind' ? -30 : p.art.box.b;
                return (
                  <rect
                    key={'hit' + p.i}
                    className="dcf-hit"
                    x={p.x + bx[0] * p.scale}
                    y={p.y + top * p.scale}
                    width={(bx[1] - bx[0]) * p.scale}
                    height={(bottom - top) * p.scale}
                    rx={12}
                    role="button"
                    tabIndex={0}
                    aria-label={(p.m.name || p.m.kind) + (p.m.says ? ': ' + p.m.says : '')}
                    onClick={() => poke(p.i)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        poke(p.i);
                      }
                    }}
                  />
                );
              })}
          </svg>

          <div className="dcf-bubbles" aria-live="polite">
            {placed.map((p) =>
              talking === p.i && p.m.says ? (
                <div
                  key={p.i}
                  className={'dcf-bubble' + (p.x > view.x + view.w * 0.72 ? ' is-left' : '')}
                  style={{ left: pct(p.x, view.x, view.w), top: pct(p.y + p.art.box.t * p.scale - 6, view.y, view.h) }}
                >
                  {p.m.says}
                </div>
              ) : null,
            )}
          </div>
        </div>

        {doodleList.length > 0 && (
          <div className="dcf-doodles" aria-hidden="true">
            {doodleList.map((d, k) => (
              <div
                key={k}
                className="dcf-doodle"
                ref={(el) => void (doodleRefs.current[k] = el)}
                style={{ width: d.size, height: d.size, marginLeft: -d.size / 2, marginTop: -d.size / 2 }}
                onPointerDown={() => popDoodle(k)}
              >
                <span className="dcf-doodle-in" style={{ '--d': tl.doodles + k * 70 + 'ms' } as React.CSSProperties}>
                  <svg viewBox="-16 -16 32 32" width={d.size} height={d.size}>
                    <DesenhoRabisco tipo={d.kind} />
                  </svg>
                </span>
              </div>
            ))}
          </div>
        )}

        <div className="dcf-cta">
          <p className="dcf-tagline">
            {words.map((w, k) => (
              <span key={k} className="dcf-word" style={{ '--d': tl.word(k) + 'ms' } as React.CSSProperties}>
                {w}{' '}
              </span>
            ))}
          </p>
          {actions.length > 0 && (
            <div className="dcf-actions">
              {actions.map((a, k) => {
                const inner = (
                  <>
                    {a.icon && <IconeRabisco tipo={a.icon} className="dcf-icon" />}
                    <span>{a.label}</span>
                  </>
                );
                const cls = 'dcf-btn dcf-pop ' + (a.variant === 'outline' ? 'is-outline' : 'is-solid');
                const st = { '--d': tl.action(k) + 'ms' } as React.CSSProperties;
                if (!a.href) {
                  return (
                    <button key={a.label} type="button" className={cls} style={st} onClick={a.onClick}>
                      {inner}
                    </button>
                  );
                }
                return a.href.startsWith('/') ? (
                  <Link key={a.label} className={cls} style={st} href={a.href} onClick={a.onClick}>
                    {inner}
                  </Link>
                ) : (
                  <a key={a.label} className={cls} style={st} href={a.href} onClick={a.onClick}>
                    {inner}
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="dcf-bar dcf-rise" style={{ '--d': '120ms' } as React.CSSProperties}>
        <p className="dcf-copy">{copyright}</p>
        {legal.length > 0 && (
          <ul className="dcf-inline">
            {legal.map((l) => (
              <li key={l.label}>
                <ItemDoRodape link={l} className="dcf-link" />
              </li>
            ))}
          </ul>
        )}
        {socials.length > 0 && (
          <ul className="dcf-inline dcf-socials">
            {socials.map((l) => (
              <li key={l.label}>
                <ItemDoRodape link={l} className="dcf-link" />
              </li>
            ))}
          </ul>
        )}
        {backToTop && (
          <button type="button" className="dcf-totop" onClick={toTop}>
            <span>Voltar ao topo</span>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M12 20 C11 14 12.5 9 12 4 M6 10 C8 8 10 6 12 4 C14 6 16 8 18.5 9.5" />
            </svg>
          </button>
        )}
      </div>
    </footer>
  );
}

const CSS =
  ".dcf{position:relative;isolation:isolate;overflow:hidden;overflow:clip;width:100%;box-sizing:border-box;display:flex;flex-direction:column;background:var(--dcf-bg);color:var(--dcf-ink);font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Inter,Roboto,sans-serif;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;--dcf-soft:color-mix(in oklab,var(--dcf-ink) 62%,var(--dcf-bg));--dcf-line:color-mix(in oklab,var(--dcf-ink) 14%,var(--dcf-bg));--dcf-pad:clamp(16px,4vw,56px);border-top:1px solid var(--dcf-line)}" +
  ':where(.dcf) *,:where(.dcf) *::before,:where(.dcf) *::after{box-sizing:border-box}' +
  ':where(.dcf) a{color:inherit;text-decoration:none}' +
  ':where(.dcf) button{appearance:none;background:none;border:0;padding:0;margin:0;font:inherit;color:inherit;cursor:pointer}' +
  ':where(.dcf) h2,:where(.dcf) h3,:where(.dcf) p,:where(.dcf) ul{margin:0;padding:0}' +
  ':where(.dcf) ul{list-style:none}' +
  '.dcf svg{max-width:none;overflow:visible}' +
  '.dcf :focus-visible{outline:2px dashed var(--dcf-ink);outline-offset:4px;border-radius:6px}' +
  '.dcf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}' +
  // faixa de cima
  '.dcf-top{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,2fr);grid-template-rows:auto 1fr;column-gap:clamp(24px,5vw,80px);row-gap:14px;padding:clamp(28px,4.5vw,56px) var(--dcf-pad) 0;max-width:1360px;width:100%;margin:0 auto;position:relative;z-index:3}' +
  '.dcf-brand{display:flex;align-items:center;gap:10px;grid-column:1;grid-row:1}' +
  '.dcf-logo{display:grid;place-items:center;width:40px;height:40px;border-radius:999px;border:2px solid var(--dcf-ink);background:var(--dcf-bg);transform:rotate(-6deg);transition:transform .35s cubic-bezier(.3,1.6,.5,1)}' +
  '.dcf-brand:hover .dcf-logo{transform:rotate(8deg) scale(1.06)}' +
  '.dcf-brandname{font-weight:800;font-size:19px;letter-spacing:-.02em}' +
  '.dcf-blurb{grid-column:1;grid-row:2;font-family:var(--dcf-serif);font-size:15px;line-height:1.55;color:var(--dcf-soft);max-width:34ch}' +
  '.dcf-cols{grid-column:2;grid-row:1/span 2;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:20px}' +
  '.dcf-coltitle{font-size:12px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;margin-bottom:12px}' +
  '.dcf-col li{margin:0 0 7px}' +
  '.dcf-link{position:relative;display:inline-block;font-size:14px;font-weight:550;color:var(--dcf-soft);padding:2px 0;transition:color .2s}' +
  'a.dcf-link:hover{color:var(--dcf-ink)}' +
  '.dcf-squiggle{position:absolute;left:-2px;right:-2px;bottom:-4px;width:calc(100% + 4px);height:7px;pointer-events:none}' +
  '.dcf-squiggle path{fill:none;stroke:var(--dcf-accent);stroke-width:2.2;stroke-linecap:round;stroke-dasharray:1;stroke-dashoffset:1;transition:stroke-dashoffset .35s cubic-bezier(.4,0,.2,1)}' +
  '.dcf-link:hover .dcf-squiggle path,.dcf-link:focus-visible .dcf-squiggle path{stroke-dashoffset:0}' +
  // mundo
  '.dcf-world{position:relative;flex:1;display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(22px,4vw,48px) var(--dcf-pad) 0;max-width:1360px;width:100%;margin:0 auto}' +
  '.dcf-stage{position:relative;z-index:1}' +
  '.dcf-svg{display:block;width:100%;height:auto;user-select:none;-webkit-user-select:none}' +
  '.dcf-svg text{fill:var(--dcf-ink)}' +
  '.dcf-art{fill:var(--dcf-bg);stroke:var(--dcf-ink);stroke-width:2.5;stroke-linecap:round;stroke-linejoin:round}' +
  '.dcf-art .n{fill:none}.dcf-art .k{fill:var(--dcf-ink)}.dcf-art .a{fill:var(--dcf-accent)}.dcf-art .o{fill:#ff9f1c}.dcf-art .r{fill:#ff4d4d}' +
  '.dcf-art .thin{stroke-width:1.5}.dcf-art .thick{stroke-width:3.4}' +
  '.dcf-art .dcf-glint{fill:var(--dcf-bg);stroke:none}' +
  '.dcf-art .dcf-shadow{fill:var(--dcf-ink);stroke:none;opacity:.14}' +
  '.dcf-ground path{fill:none;stroke:var(--dcf-ink);stroke-width:2.4;stroke-linecap:round}' +
  '.dcf-ground .dcf-tufts{stroke-width:1.8}' +
  '.dcf-pebble{fill:var(--dcf-bg);stroke:var(--dcf-ink);stroke-width:1.6}' +
  '.dcf-dust{fill:none;stroke:var(--dcf-ink);stroke-width:3;stroke-linecap:round;opacity:0}' +
  '.dcf-hit{fill:transparent;stroke:none;cursor:pointer;outline:none}' +
  '.dcf-hit:focus-visible{stroke:var(--dcf-ink);stroke-width:2.5;stroke-dasharray:6 6}' +
  '.dcf-glyph{transform-box:fill-box;transform-origin:50% 100%}' +
  ".dcf[data-interactive='1'] .dcf-glyph:hover{animation:dcf-jiggle .6s cubic-bezier(.3,1.5,.5,1)}" +
  '.dcf-art.dcf-bob{animation:dcf-bob 3.2s ease-in-out infinite}' +
  '.dcf-art.dcf-sway{transform-box:fill-box;transform-origin:50% 100%;animation:dcf-swing 4s ease-in-out infinite}' +
  '.dcf-art.dcf-peck{transform-box:fill-box;transform-origin:50% 100%;animation:dcf-peck 5.5s ease-in-out infinite}' +
  '.dcf-tail{transform-box:fill-box;transform-origin:0% 100%;animation:dcf-tail 2.8s ease-in-out infinite}' +
  '.dcf-hopper{transform-box:fill-box;transform-origin:50% 100%}' +
  '.dcf-hopper.is-hop{animation:dcf-hop .62s cubic-bezier(.3,.7,.4,1)}' +
  '.dcf-arrive{transform-box:fill-box;transform-origin:50% 100%}' +
  // balões
  '.dcf-bubbles{position:absolute;inset:0;pointer-events:none;z-index:2}' +
  '.dcf-bubble{position:absolute;transform:translate(-50%,-100%) rotate(-2deg);transform-origin:50% 100%;background:var(--dcf-bg);color:var(--dcf-ink);border:2px solid var(--dcf-ink);border-radius:16px;padding:7px 12px;font-size:13px;font-weight:700;line-height:1.25;white-space:nowrap;box-shadow:3px 3px 0 var(--dcf-ink);animation:dcf-bubble .32s cubic-bezier(.3,1.6,.5,1) both;margin-top:-4px}' +
  ".dcf-bubble::after{content:'';position:absolute;left:50%;bottom:-9px;width:14px;height:14px;background:var(--dcf-bg);border-right:2px solid var(--dcf-ink);border-bottom:2px solid var(--dcf-ink);transform:translateX(-50%) rotate(45deg) skew(8deg,8deg)}" +
  '.dcf-bubble.is-left{transform:translate(-88%,-100%) rotate(2deg);transform-origin:88% 100%}' +
  '.dcf-bubble.is-left::after{left:88%}' +
  // rabiscos
  '.dcf-doodles{position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden}' +
  '.dcf-doodle{position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;will-change:transform;touch-action:manipulation}' +
  '.dcf-doodle-in{display:block;width:100%;height:100%}' +
  ".dcf[data-interactive='0'] .dcf-doodle{pointer-events:none}" +
  '.dcf-doodle svg,.dcf-icon{display:block;stroke:var(--dcf-ink);stroke-width:1.9;stroke-linejoin:round;stroke-linecap:round}' +
  '.dcf-doodle svg{width:100%;height:100%;filter:drop-shadow(2px 2px 0 color-mix(in oklab,var(--dcf-ink) 18%,transparent))}' +
  '.dcf-paperfill{fill:var(--dcf-bg)}' +
  // chamada
  '.dcf-cta{position:relative;z-index:3;display:flex;flex-direction:column;align-items:center;gap:20px;padding:clamp(20px,3vw,34px) 0 clamp(30px,4vw,48px);text-align:center}' +
  '.dcf-tagline{font-family:var(--dcf-serif);font-size:clamp(17px,1.9vw,22px);line-height:1.4;letter-spacing:-.005em;max-width:44ch;text-wrap:balance}' +
  '.dcf-word{display:inline-block;white-space:pre}' +
  '.dcf-actions{display:flex;flex-wrap:wrap;justify-content:center;gap:12px}' +
  '.dcf-btn{display:inline-flex;align-items:center;gap:8px;height:46px;padding:0 20px 0 16px;border-radius:999px;border:2px solid var(--dcf-ink);font-size:14.5px;font-weight:750;letter-spacing:-.01em;box-shadow:0 3px 0 var(--dcf-ink);transition:transform .18s cubic-bezier(.3,1.4,.5,1),box-shadow .18s cubic-bezier(.3,1.4,.5,1)}' +
  '.dcf-btn.is-outline{background:var(--dcf-bg);color:var(--dcf-ink)}' +
  '.dcf-btn.is-solid{background:var(--dcf-ink);color:var(--dcf-bg);box-shadow:0 3px 0 var(--dcf-accent)}' +
  '.dcf-btn.is-solid .dcf-icon{stroke:var(--dcf-bg)}' +
  '.dcf-btn:hover{transform:translateY(-2px) rotate(-1.2deg);box-shadow:0 5px 0 var(--dcf-ink)}' +
  '.dcf-btn.is-solid:hover{box-shadow:0 5px 0 var(--dcf-accent)}' +
  '.dcf-btn:active{transform:translateY(2px);box-shadow:0 1px 0 var(--dcf-ink);transition-duration:.06s}' +
  '.dcf-btn.is-solid:active{box-shadow:0 1px 0 var(--dcf-accent)}' +
  '.dcf-btn:hover .dcf-icon{animation:dcf-wiggle .5s ease-in-out}' +
  // barra
  '.dcf-bar{position:relative;z-index:3;display:flex;flex-wrap:wrap;align-items:center;gap:10px 26px;padding:18px var(--dcf-pad) 22px;max-width:1360px;width:100%;margin:0 auto;border-top:1.5px dashed var(--dcf-line);font-size:13px}' +
  '.dcf-copy{color:var(--dcf-soft);margin-right:auto}' +
  '.dcf-inline{display:flex;flex-wrap:wrap;gap:4px 18px}' +
  '.dcf-inline .dcf-link{font-size:13px}' +
  '.dcf-socials .dcf-link{color:var(--dcf-ink);font-weight:700}' +
  '.dcf-totop{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;padding:6px 12px;border-radius:999px;border:1.5px solid var(--dcf-ink);transition:transform .2s cubic-bezier(.3,1.5,.5,1)}' +
  '.dcf-totop svg{fill:none;stroke:currentColor;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}' +
  '.dcf-totop:hover{transform:translateY(-2px)}' +
  '.dcf-totop:hover svg{animation:dcf-up .6s ease-in-out infinite}' +
  // storyboard: escondido até tocar, depois cada peça entra no seu --d
  ".dcf[data-play='0'] .dcf-letter,.dcf[data-play='0'] .dcf-arrive,.dcf[data-play='0'] .dcf-word,.dcf[data-play='0'] .dcf-pop,.dcf[data-play='0'] .dcf-rise,.dcf[data-play='0'] .dcf-fade,.dcf[data-play='0'] .dcf-doodle-in{opacity:0}" +
  ".dcf[data-play='0'] .dcf-draw{stroke-dasharray:1;stroke-dashoffset:1}" +
  '.dcf-letter{transform-box:fill-box;transform-origin:50% 100%}' +
  ".dcf[data-play='1'] .dcf-letter{animation:dcf-stamp .62s cubic-bezier(.2,.8,.25,1.15) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-dust{animation:dcf-dust .5s ease-out calc(var(--d) + .22s) both}" +
  ".dcf[data-play='1'] .dcf-draw{stroke-dasharray:1;animation:dcf-draw 1.1s cubic-bezier(.6,0,.3,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-fade{animation:dcf-fade .6s ease-out var(--d) both}" +
  ".dcf[data-play='1'] .dcf-arrive-front{animation:dcf-rise-up .75s cubic-bezier(.3,1.5,.5,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-arrive-top{animation:dcf-plop .8s cubic-bezier(.3,.9,.4,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-arrive-behind{animation:dcf-peek .9s cubic-bezier(.3,1.4,.5,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-word{animation:dcf-word .6s cubic-bezier(.2,.8,.3,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-pop{animation:dcf-popin .55s cubic-bezier(.3,1.6,.5,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-rise{animation:dcf-fadeup .7s cubic-bezier(.2,.8,.3,1) var(--d) both}" +
  ".dcf[data-play='1'] .dcf-doodle-in{animation:dcf-fade .6s ease-out var(--d) both}" +
  '@keyframes dcf-stamp{0%{opacity:0;transform:translateY(-34%) scale(1.28) rotate(var(--r))}55%{opacity:1;transform:translateY(2%) scale(.95,1.05) rotate(0deg)}75%{transform:translateY(0) scale(1.04,.95)}100%{opacity:1;transform:none}}' +
  '@keyframes dcf-dust{0%{opacity:0;stroke-dasharray:0 40}30%{opacity:.9}100%{opacity:0;stroke-dasharray:14 40;stroke-dashoffset:-16}}' +
  '@keyframes dcf-draw{to{stroke-dashoffset:0}}' +
  '@keyframes dcf-fade{from{opacity:0}to{opacity:1}}' +
  '@keyframes dcf-rise-up{0%{opacity:0;transform:translateY(30%) scale(.7,.3)}45%{opacity:1;transform:translateY(-8%) scale(.92,1.12)}70%{transform:translateY(0) scale(1.08,.92)}100%{opacity:1;transform:none}}' +
  '@keyframes dcf-plop{0%{opacity:0;transform:translateY(-90%)}50%{opacity:1;transform:translateY(0) scale(1.1,.86)}68%{transform:translateY(-10%) scale(.96,1.04)}84%{transform:translateY(0) scale(1.03,.97)}100%{opacity:1;transform:none}}' +
  '@keyframes dcf-peek{0%{opacity:0;transform:translateY(55%)}60%{opacity:1;transform:translateY(-6%)}100%{opacity:1;transform:none}}' +
  '@keyframes dcf-word{from{opacity:0;transform:translateY(.6em) rotate(3deg)}to{opacity:1;transform:none}}' +
  '@keyframes dcf-popin{0%{opacity:0;transform:translateY(10px) scale(.6) rotate(-4deg)}100%{opacity:1;transform:none}}' +
  '@keyframes dcf-fadeup{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}' +
  '@keyframes dcf-jiggle{0%{transform:none}25%{transform:rotate(-4deg) scale(1.03,.97)}50%{transform:rotate(3deg) translateY(-3%)}75%{transform:rotate(-1.5deg)}100%{transform:none}}' +
  '@keyframes dcf-hop{0%{transform:none}18%{transform:scale(1.12,.84)}45%{transform:translateY(-28%) scale(.94,1.08)}72%{transform:translateY(0) scale(1.1,.88)}86%{transform:scale(.97,1.03)}100%{transform:none}}' +
  '@keyframes dcf-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-5px)}}' +
  '@keyframes dcf-swing{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2.5deg)}}' +
  '@keyframes dcf-peck{0%,62%,100%{transform:none}66%{transform:rotate(14deg) translateY(2px)}70%{transform:none}74%{transform:rotate(12deg) translateY(2px)}78%{transform:none}}' +
  '@keyframes dcf-tail{0%,100%{transform:rotate(0deg)}50%{transform:rotate(-12deg)}}' +
  '@keyframes dcf-bubble{from{opacity:0;scale:.6}to{opacity:1;scale:1}}' +
  '@keyframes dcf-wiggle{0%,100%{transform:none}30%{transform:rotate(-14deg) scale(1.15)}60%{transform:rotate(10deg)}}' +
  '@keyframes dcf-up{0%,100%{transform:none}50%{transform:translateY(-3px)}}' +
  '@media (max-width:860px){.dcf-top{grid-template-columns:1fr;grid-template-rows:auto}.dcf-brand,.dcf-blurb,.dcf-cols{grid-column:1;grid-row:auto}.dcf-cols{grid-template-columns:repeat(2,minmax(0,1fr));margin-top:14px;row-gap:22px}.dcf-copy{width:100%;margin-right:0}}' +
  '@media (max-width:480px){.dcf-btn{height:42px;font-size:13.5px;padding:0 16px 0 13px}.dcf-bubble{font-size:12px;padding:6px 10px}.dcf-totop span{display:none}}' +
  '@media (prefers-reduced-motion:reduce){.dcf *,.dcf *::before,.dcf *::after{animation:none!important;transition:none!important}.dcf .dcf-letter,.dcf .dcf-arrive,.dcf .dcf-word,.dcf .dcf-pop,.dcf .dcf-rise,.dcf .dcf-fade,.dcf .dcf-doodle-in{opacity:1!important}.dcf .dcf-draw{stroke-dashoffset:0!important}.dcf .dcf-dust{opacity:0!important}}';
