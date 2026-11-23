'use client';

import * as React from 'react';

/**
 * O baixista do LASTRO: um personagem a mais na turma do rodapé (RodapeLastro).
 *
 * Depois que a logo terminou de se montar, ele entra pela direita, pula O → R → T → S, espera
 * o passarinho liberar a letra A, senta nela, puxa das costas um contrabaixo elétrico e fica
 * tocando enquanto a página estiver aberta.
 *
 * O desenho é articulado: pernas e braços são "mangueiras" de cartoon (uma curva com contorno)
 * que dobram no joelho e no cotovelo conforme a distância entre a junta e a ponta. A cada
 * quadro o roteiro calcula uma pose (quadril, pés, mãos, cabeça, olhar, baixo) e ela vira
 * atributos do SVG — sem render do React.
 *
 * Os pulos têm preparação (agacha, braços para trás), impulso (estica, braços para cima), voo
 * balístico com gravidade (x constante, y em parábola, pernas encolhem no alto e esticam para
 * pousar), aterrissagem que amortece com poeira e uma mola de volta. Os pontos de apoio vêm da
 * posição medida das letras, então tudo acompanha a largura da tela.
 *
 * Unidades da arte: pés em (0, 0), para cima é negativo, ~144 = altura de uma maiúscula.
 */

export type PontoBx = { x: number; y: number };

export type RoteiroBaixista = {
  /** Escala do desenho (unidades da arte → unidades do SVG). */
  escala: number;
  /** Altura das maiúsculas, no SVG. */
  cap: number;
  /** Onde ele aparece (fora da logo, à direita) e onde para antes do primeiro pulo. */
  entrada: PontoBx;
  parada: PontoBx;
  /** Os apoios em cima das letras, na ordem: O, R, T, S e por fim a A (onde senta). */
  apoios: PontoBx[];
  /** Topo do que está entre o apoio j e o j+1 (ex.: a cabeça do menino no T); NaN = nada. */
  obstaculos: number[];
};

export type ReacaoBx = 'agacha' | 'afunda' | 'volta' | 'voa' | 'senta' | 'toca';

type V = PontoBx;

// ---------------------------------------------------------------------------
// Geometria do boneco
// ---------------------------------------------------------------------------

/** Altura do quadril em pé (acima dos pés). */
const QUADRIL = 34;
/** Juntas, nas coordenadas do tronco (origem no quadril). */
const JUNTA_PERNA = [{ x: -7, y: 2 }, { x: 7, y: 2 }];
const OMBRO = [{ x: -20, y: -28 }, { x: 20, y: -28 }];
const PERNA = 29;
const BRACO = 27;
const CABECA_Y = -54;

const PES_EM_PE: [V, V] = [{ x: -9, y: -5 }, { x: 9, y: -5 }];
const MAOS_REPOUSO: [V, V] = [{ x: -24, y: -4 }, { x: 24, y: -4 }];
const MAOS_TRAS: [V, V] = [{ x: -28, y: -1 }, { x: 28, y: -1 }];
const MAOS_CIMA: [V, V] = [{ x: -15, y: -63 }, { x: 15, y: -63 }];
const MAOS_ABERTAS: [V, V] = [{ x: -42, y: -40 }, { x: 42, y: -40 }];
const MAOS_POUSO: [V, V] = [{ x: -34, y: -15 }, { x: 34, y: -15 }];
const MAOS_AMORTECE: [V, V] = [{ x: -33, y: -6 }, { x: 33, y: -6 }];
/** Sentado: pés pendurados na frente da letra e mãos nos joelhos. */
const PES_SENTADO: [V, V] = [{ x: -10, y: 26 }, { x: 10, y: 26 }];
const MAOS_JOELHO: [V, V] = [{ x: -15, y: 11 }, { x: 15, y: 11 }];
const QUADRIL_SENTADO = 3;

type Pose = {
  /** Ponto de apoio (entre os pés), no SVG. */
  x: number;
  y: number;
  /** Inclinação do corpo em graus, em torno do quadril. */
  inclina: number;
  /** Altura do quadril acima do apoio. */
  P: number;
  /** Tornozelos (coordenadas do corpo: origem no apoio). */
  pes: [V, V];
  /** Mãos (coordenadas do tronco: origem no quadril). */
  maos: [V, V];
  cabeca: number;
  olhar: V;
  sx: number;
  sy: number;
  /** 0 = baixo nas costas, 1 = em posição de tocar. */
  baixo: number;
  /** 1 = olhos fechados de satisfação. */
  feliz: number;
};

const BASE: Omit<Pose, 'x' | 'y'> = {
  inclina: 0, P: QUADRIL, pes: PES_EM_PE, maos: MAOS_REPOUSO, cabeca: 0, olhar: { x: 0, y: 0 }, sx: 1, sy: 1, baixo: 0, feliz: 0,
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpV = (a: V, b: V, t: number): V => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
const lerpPar = (a: [V, V], b: [V, V], t: number): [V, V] => [lerpV(a[0], b[0], t), lerpV(a[1], b[1], t)];
const suave = (t: number) => t * t * (3 - 2 * t);
const sai = (t: number) => 1 - Math.pow(1 - t, 3);
/** Mola: sai de 0, passa um pouco de 1 e assenta. */
const mola = (t: number) => 1 - Math.exp(-6 * t) * Math.cos(11 * t);
const trecho = (t: number, a: number, b: number) => clamp01((t - a) / (b - a));
const num = (n: number) => (Math.round(n * 100) / 100).toString();

/**
 * Membro de mangueira: curva da junta à ponta. Se a ponta está mais perto que o comprimento,
 * o meio "dobra" para o lado de `pref` (joelho para fora, cotovelo para fora e para baixo).
 */
function mangueira(a: V, b: V, L: number, pref: V, ganho = 0.5) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const d = Math.hypot(dx, dy) || 1e-6;
  const dobra = Math.sqrt(Math.max(0, L * L - d * d)) * ganho;
  let nx = -dy / d;
  let ny = dx / d;
  if (nx * pref.x + ny * pref.y < 0) { nx = -nx; ny = -ny; }
  const c = { x: (a.x + b.x) / 2 + nx * dobra, y: (a.y + b.y) / 2 + ny * dobra };
  return { d: `M${num(a.x)} ${num(a.y)}Q${num(c.x)} ${num(c.y)} ${num(b.x)} ${num(b.y)}`, a, c, b };
}

/** O braço não estica além do comprimento: a mão para no alcance. */
function alcance(ombro: V, alvo: V, L: number): V {
  const dx = alvo.x - ombro.x;
  const dy = alvo.y - ombro.y;
  const d = Math.hypot(dx, dy);
  const max = L * 1.08;
  return d <= max ? alvo : { x: ombro.x + (dx / d) * max, y: ombro.y + (dy / d) * max };
}

// O baixo: centro do corpo e rotação (o braço do instrumento aponta para -x antes de girar).
// O desenho do instrumento é reduzido para ficar do tamanho de um baixo nas mãos dele.
const ESCALA_BAIXO = 0.8;
type Baixo = { x: number; y: number; r: number };
const COSTAS: Baixo = { x: -6, y: -20, r: 120 };
const TOCANDO: Baixo = { x: 10, y: -8, r: 22 };
/** Distâncias ao longo do braço (já na escala do tronco). */
const PEGA_COSTAS = 44;
const CASA_BASE = 56;

function baixoEm(b: number): Baixo {
  const t = suave(b);
  // Passa por cima da cabeça, como quem tira a correia das costas.
  return {
    x: lerp(COSTAS.x, TOCANDO.x, t) + Math.sin(Math.PI * t) * 26,
    y: lerp(COSTAS.y, TOCANDO.y, t) - Math.sin(Math.PI * t) * 22,
    r: lerp(COSTAS.r, TOCANDO.r, sai(b)),
  };
}
const noBraco = (bx: Baixo, d: number): V => {
  const r = (bx.r * Math.PI) / 180;
  return { x: bx.x - Math.cos(r) * d, y: bx.y - Math.sin(r) * d };
};
const noCorpo = (bx: Baixo, a: number): V => {
  const r = (bx.r * Math.PI) / 180;
  return { x: bx.x + Math.cos(r) * a, y: bx.y + Math.sin(r) * a };
};

// ---------------------------------------------------------------------------
// As poses de cada momento
// ---------------------------------------------------------------------------

const pose = (p: V, extra: Partial<Pose> = {}): Pose => ({ ...BASE, x: p.x, y: p.y, ...extra });

/** Respira parado (o quadril sobe e desce um tiquinho). */
const respira = (t: number) => Math.sin(t * Math.PI * 2) * 0.5;

/** Andando para a esquerda: passo alternado, quadril quicando, braços em contraposição. */
function andar(de: V, ate: V, t: number, durS: number): Pose {
  const fase = t * durS * Math.PI * 2 * 1.45;
  const amp = 1 - suave(trecho(t, 0.82, 1));
  const s = Math.sin(fase);
  const c = Math.cos(fase);
  return pose({ x: lerp(de.x, ate.x, suave(t) * 0.25 + t * 0.75), y: ate.y }, {
    P: QUADRIL + Math.abs(s) * 1.6 * amp,
    pes: [
      { x: -9 + 4 * s * amp, y: -5 - Math.max(0, c) * 7 * amp },
      { x: 9 + 4 * s * amp, y: -5 - Math.max(0, -c) * 7 * amp },
    ],
    maos: [
      { x: -24 - 3 * s * amp, y: -4 - 3 * Math.max(0, -c) * amp },
      { x: 24 - 3 * s * amp, y: -4 - 3 * Math.max(0, c) * amp },
    ],
    inclina: -4 * amp,
    cabeca: (-3 + Math.sin(fase * 2) * 1.5) * amp,
    olhar: { x: -2.6 * amp, y: 0 },
  });
}

/** Para, acena para quem está olhando (com um sorriso de olhos fechados) e olha as letras. */
function acenar(p: V, t: number): Pose {
  const sobe = suave(trecho(t, 0, 0.18)) * (1 - suave(trecho(t, 0.72, 0.9)));
  const olhaCima = suave(trecho(t, 0.85, 1));
  const mao: V = { x: 27 + Math.sin(t * Math.PI * 9) * 6 * sobe, y: -62 };
  return pose(p, {
    P: QUADRIL + respira(t * 2),
    maos: [MAOS_REPOUSO[0], lerpV(MAOS_REPOUSO[1], mao, sobe)],
    cabeca: 5 * sobe - 5 * olhaCima,
    feliz: sobe > 0.55 && t < 0.7 ? 1 : 0,
    olhar: lerpV({ x: 0, y: 0 }, { x: -2.4, y: -3 }, olhaCima),
    inclina: 2 * sobe,
  });
}

type Voo = { de: V; para: V; T: number; g: number; v0: number; dir: number };

/** Lançamento balístico de `de` a `para` com o pico no `topo` (o mais alto entre livre e obstáculo). */
function voo(de: V, para: V, cap: number, obstaculo: number, subida = 0.3): Voo {
  let topo = Math.min(de.y, para.y) - subida * cap;
  if (Number.isFinite(obstaculo)) topo = Math.min(topo, obstaculo - 0.04 * cap);
  const g = 13 * cap;
  const sobe = Math.sqrt((2 * Math.max(1, de.y - topo)) / g);
  const desce = Math.sqrt((2 * Math.max(1, para.y - topo)) / g);
  // Pulo no lugar (x igual): dir 0, sem inclinar para lado nenhum.
  const dx = para.x - de.x;
  return { de, para, T: sobe + desce, g, v0: g * sobe, dir: Math.abs(dx) < 1e-6 ? 0 : Math.sign(dx) };
}

/** Agacha para pular: quadril desce, joelhos abrem, braços vão para trás, olha o destino. */
function prepara(p: V, dir: number, t: number, primeiro: boolean): Pose {
  const c = suave(t);
  return pose(p, {
    P: QUADRIL - (primeiro ? 15 : 13) * c,
    pes: [{ x: -9 - 2.5 * c, y: -5 }, { x: 9 + 2.5 * c, y: -5 }],
    maos: lerpPar(MAOS_REPOUSO, MAOS_TRAS, c),
    inclina: dir * 6 * c,
    sx: 1 + 0.04 * c,
    sy: 1 - 0.06 * c,
    cabeca: dir * 3 * c,
    olhar: { x: dir * 2.6 * c, y: (primeiro ? -3 : -1.5) * c },
  });
}

/** Impulso: estica tudo, pés na ponta, braços para cima. */
function impulso(p: V, dir: number, t: number, primeiro: boolean): Pose {
  const e = sai(t);
  return pose(p, {
    P: lerp(QUADRIL - (primeiro ? 15 : 13), QUADRIL + 3, e),
    pes: [{ x: lerp(-11.5, -8, e), y: lerp(-5, -1.5, e) }, { x: lerp(11.5, 8, e), y: lerp(-5, -1.5, e) }],
    maos: lerpPar(MAOS_TRAS, MAOS_CIMA, e),
    inclina: dir * lerp(6, 10, e),
    sx: lerp(1.04, 0.94, e),
    sy: lerp(0.94, 1.09, e),
    cabeca: dir * 3,
    olhar: { x: dir * 2.6, y: -2 },
  });
}

/** No ar: x constante, y com gravidade; encolhe as pernas no alto e estica para pousar. */
function noAr(v: Voo, u: number): Pose {
  const t = u * v.T;
  const x = lerp(v.de.x, v.para.x, u);
  const y = v.de.y - v.v0 * t + 0.5 * v.g * t * t;
  const encolhe = Math.pow(Math.sin(Math.PI * clamp01(u * 1.15)), 1.3);
  const estende = suave(trecho(u, 0.72, 1));
  const pes: [V, V] = [
    { x: -8 + 1.5 * encolhe, y: -1.5 - 13 * encolhe * (1 - estende) - estende },
    { x: 8 - 1.5 * encolhe, y: -1.5 - 15 * encolhe * (1 - estende) - estende },
  ];
  const balanco = Math.sin(u * Math.PI * 3) * 2.5;
  let maos = lerpPar(MAOS_CIMA, MAOS_ABERTAS, suave(trecho(u, 0, 0.4)));
  maos = [{ x: maos[0].x, y: maos[0].y + balanco }, { x: maos[1].x, y: maos[1].y - balanco }];
  maos = lerpPar(maos, MAOS_POUSO, suave(trecho(u, 0.75, 1)));
  return pose({ x, y }, {
    P: QUADRIL + 3 - 3 * encolhe,
    pes,
    maos,
    inclina: v.dir * lerp(10, -6, suave(u)),
    sx: u < 0.25 ? lerp(0.94, 1, u / 0.25) : 1,
    sy: u < 0.25 ? lerp(1.09, 1, u / 0.25) : 1 + 0.04 * estende,
    cabeca: v.dir * lerp(3, -2, u),
    olhar: { x: v.dir * 2.4, y: lerp(-2, 2.6, u) },
  });
}

/** Pousa: os joelhos amortecem, os braços abrem e descem, o corpo achata. */
function pousa(p: V, dir: number, t: number): Pose {
  const a = sai(t);
  return pose(p, {
    P: lerp(QUADRIL + 1, QUADRIL - 14, a),
    pes: [{ x: lerp(-8, -10.5, a), y: -5 }, { x: lerp(8, 10.5, a), y: -5 }],
    maos: lerpPar(MAOS_POUSO, MAOS_AMORTECE, a),
    inclina: dir * lerp(-6, 3, a),
    sx: 1 + 0.09 * a,
    sy: 1 - 0.11 * a,
    cabeca: dir * -2 * (1 - a) + 2 * a,
    olhar: { x: dir * 1.5, y: 2.4 },
  });
}

/** Volta a ficar em pé com uma mola (passa um pouco do ponto e assenta). */
function recupera(p: V, dir: number, t: number): Pose {
  const m = mola(t);
  return pose(p, {
    P: lerp(QUADRIL - 14, QUADRIL, m),
    pes: [{ x: lerp(-10.5, -9, m), y: -5 }, { x: lerp(10.5, 9, m), y: -5 }],
    maos: lerpPar(MAOS_AMORTECE, MAOS_REPOUSO, suave(t)),
    inclina: dir * 3 * (1 - m),
    sx: lerp(1.09, 1, m),
    sy: lerp(0.89, 1, m),
    cabeca: 2 * (1 - m),
    olhar: { x: dir * 2.2 * suave(t), y: lerp(2.4, 0, suave(t)) },
  });
}

/** Depois de amassar a letra: volta da mola olhando para baixo, cabeça de lado, desconfiado. */
function confere(p: V, t: number, lado: number): Pose {
  const base = recupera(p, 0, t);
  const olha = suave(trecho(t, 0.15, 0.45));
  return {
    ...base,
    olhar: { x: lado * 1.2 * olha, y: 3.2 * olha },
    cabeca: lado * 8 * olha,
    inclina: lado * 2 * olha,
    maos: lerpPar(base.maos, [{ x: -27, y: -8 }, { x: 27, y: -8 }], olha),
  };
}

/** A pausa do "fui eu?": olha para quem está vendo, dá de ombros e abre um sorriso. */
function deOmbros(p: V, t: number): Pose {
  const olha = suave(trecho(t, 0, 0.2));
  const ombros = Math.sin(Math.PI * trecho(t, 0.3, 0.75));
  return pose(p, {
    P: QUADRIL + respira(t * 2) + ombros * 1.5,
    maos: lerpPar(MAOS_REPOUSO, [{ x: -33, y: -20 }, { x: 33, y: -20 }], ombros),
    sy: 1 + 0.035 * ombros,
    cabeca: 7 * ombros,
    olhar: lerpV({ x: 0, y: 2.4 }, { x: 0, y: 0 }, olha),
    feliz: t > 0.62 ? 1 : 0,
  });
}

/** O passarinho percebe e vai embora: ele acompanha com o olhar e acena tchau. */
function despedida(p: V, t: number): Pose {
  const tchau = suave(trecho(t, 0.35, 0.5)) * (1 - suave(trecho(t, 0.85, 1)));
  return pose(p, {
    P: QUADRIL + respira(t * 3),
    maos: [MAOS_REPOUSO[0], lerpV(MAOS_REPOUSO[1], { x: 26 + Math.sin(t * Math.PI * 10) * 5, y: -60 }, tchau)],
    cabeca: -6 * suave(trecho(t, 0, 0.3)) + 3 * tchau,
    olhar: lerpV({ x: -3, y: -2.5 }, { x: -3.5, y: -3.6 }, trecho(t, 0.3, 0.8)),
    feliz: t > 0.62 && t < 0.86 ? 1 : 0,
  });
}

/** Na A: ajeita e senta, as pernas passam para a frente da letra; mãos nos joelhos. */
function sentar(p: V, t: number): Pose {
  const sobe = suave(trecho(t, 0, 0.3));
  const s = suave(trecho(t, 0.3, 0.85));
  const assenta = Math.sin(Math.PI * trecho(t, 0.85, 1));
  const pes: [V, V] = [
    { x: lerp(-9, PES_SENTADO[0].x, s), y: lerp(-5, PES_SENTADO[0].y, s) - Math.sin(Math.PI * s) * 9 },
    { x: lerp(9, PES_SENTADO[1].x, s), y: lerp(-5, PES_SENTADO[1].y, s) - Math.sin(Math.PI * s) * 9 },
  ];
  return pose(p, {
    P: s > 0 ? lerp(QUADRIL - 6, QUADRIL_SENTADO, s) : lerp(QUADRIL, QUADRIL - 6, sobe),
    pes,
    maos: lerpPar(MAOS_REPOUSO, MAOS_JOELHO, suave(trecho(t, 0.2, 0.9))),
    sx: 1 + 0.05 * assenta,
    sy: 1 - 0.06 * assenta,
    olhar: { x: 0, y: 2.4 * (1 - s) },
    inclina: Math.sin(Math.PI * s) * -3,
  });
}

/** Mãos tocando: a esquerda no braço do baixo (distância `d`), a direita dedilhando no corpo. */
function maosTocando(bx: Baixo, dedilha: number, d: number): [V, V] {
  const corda = noCorpo(bx, 3);
  return [noBraco(bx, d), { x: corda.x + 0.6 * dedilha, y: corda.y + 1.6 * dedilha }];
}

/**
 * Busca o baixo: a mão direita vai às costas, puxa o instrumento por cima da cabeça, a esquerda
 * pega o braço dele, e as duas se ajeitam nas cordas.
 */
function puxarBaixo(p: V, t: number): Pose {
  const alcanca = suave(trecho(t, 0, 0.26));
  const b = trecho(t, 0.26, 0.74);
  const ajeita = suave(trecho(t, 0.74, 1));
  const bx = baixoEm(b);
  const final = maosTocando(baixoEm(1), 0, CASA_BASE);
  let direita = lerpV(MAOS_JOELHO[1], noBraco(baixoEm(0), PEGA_COSTAS), alcanca);
  if (b > 0) direita = lerpV(noBraco(bx, PEGA_COSTAS), noCorpo(bx, 3), suave(trecho(b, 0.4, 0.9)));
  if (ajeita > 0) direita = lerpV(noCorpo(baixoEm(1), 3), final[1], ajeita);
  let esquerda = MAOS_JOELHO[0];
  if (b > 0.45) esquerda = lerpV(MAOS_JOELHO[0], noBraco(bx, CASA_BASE), suave(trecho(b, 0.45, 0.9)));
  if (ajeita > 0) esquerda = lerpV(noBraco(baixoEm(1), CASA_BASE), final[0], ajeita);
  return pose(p, {
    P: QUADRIL_SENTADO,
    pes: PES_SENTADO,
    maos: [esquerda, direita],
    baixo: b,
    cabeca: 7 * alcanca * (1 - suave(b)) - 4 * ajeita,
    olhar: lerpV(lerpV({ x: 0, y: 0 }, { x: 2.6, y: -2.2 }, alcanca * (1 - suave(b))), { x: -1.2, y: 2.4 }, ajeita),
    inclina: Math.sin(Math.PI * b) * 4,
    sy: 1 - Math.sin(Math.PI * b) * 0.03,
  });
}

/** O estado final, em loop: groove no corpo, cabeça no tempo, dedilhado, pés balançando. */
function tocar(p: V, s: number): Pose {
  const tempo = 0.52;
  const groove = Math.sin((Math.PI * s) / tempo);
  const casa = CASA_BASE + 4 * Math.tanh(3 * Math.sin((Math.PI * s) / (tempo * 4)));
  const ciclo = s % 7;
  const abre = ciclo > 4.6 && ciclo < 5.9;
  const pe = Math.sin((Math.PI * 2 * s) / 1.7);
  return pose(p, {
    P: QUADRIL_SENTADO,
    pes: [
      { x: PES_SENTADO[0].x - 2.5 * pe, y: PES_SENTADO[0].y - 2 * Math.max(0, pe) },
      { x: PES_SENTADO[1].x + 2.5 * pe, y: PES_SENTADO[1].y - 2 * Math.max(0, -pe) },
    ],
    maos: maosTocando(baixoEm(1), Math.sin((Math.PI * 2 * s) / (tempo / 2)), casa),
    baixo: 1,
    inclina: 1.8 * groove,
    sy: 1 - (0.018 * (1 + Math.cos((Math.PI * 2 * s) / tempo))) / 2,
    cabeca: 5 * Math.sin((Math.PI * s) / tempo + 0.7),
    feliz: abre ? 0 : 1,
    olhar: abre ? { x: 1.6, y: -2.6 } : { x: 0, y: 0 },
  });
}

// ---------------------------------------------------------------------------
// O roteiro
// ---------------------------------------------------------------------------

type Segmento = { dur: number; pose: (t: number) => Pose; ao?: () => void };

/** Altura da letra A depois de cada pouso nela (1 = intacta); o amasso é permanente. */
const AMASSOS_A = [0.82, 0.67, 0.55];
const ALTURA_FINAL_A = AMASSOS_A[AMASSOS_A.length - 1];

function montarRoteiro(
  R: () => RoteiroBaixista,
  reagir: (r: ReacaoBx) => void,
  poeira: (p: V) => void,
  alturaA: () => number,
  impacto: (altura: number) => void,
): Segmento[] {
  const segs: Segmento[] = [];
  const n = R().apoios.length;
  /** O topo da A acompanha o amasso: ele afunda junto com a letra. */
  const topoA = (): V => {
    const a = R().apoios[n - 1];
    return { x: a.x, y: a.y * alturaA() };
  };
  const lugar = (k: number): V => (k === 0 ? R().parada : k === n ? topoA() : R().apoios[k - 1]);

  segs.push({ dur: 1800, pose: (t) => andar(R().entrada, R().parada, t, 1.8) });
  segs.push({ dur: 1900, pose: (t) => acenar(R().parada, t) });

  for (let k = 0; k < n; k++) {
    const de = () => lugar(k);
    const para = () => lugar(k + 1);
    const obst = () => (k >= 1 ? R().obstaculos[k - 1] ?? NaN : NaN);
    const v = () => voo(de(), para(), R().cap, obst());
    const primeiro = k === 0;
    const ultimo = k === n - 1;

    if (ultimo) segs.push({ dur: 2300, pose: (t) => despedida(de(), t), ao: () => reagir('voa') });

    segs.push({
      dur: primeiro ? 420 : 300,
      pose: (t) => prepara(de(), v().dir, t, primeiro),
      ao: () => {
        if (Number.isFinite(obst())) reagir('agacha');
        if (ultimo) reagir('volta');
      },
    });
    segs.push({ dur: 110, pose: (t) => impulso(de(), v().dir, t, primeiro) });
    segs.push({ dur: Math.round(Math.min(1100, Math.max(420, v().T * 1000))), pose: (t) => noAr(v(), t) });
    segs.push({
      dur: 160,
      pose: (t) => pousa(para(), v().dir, t),
      ao: () => {
        poeira(para());
        if (k === 3) reagir('afunda');
        if (ultimo) impacto(AMASSOS_A[0]);
      },
    });
    if (!ultimo) {
      segs.push({ dur: 420, pose: (t) => recupera(para(), v().dir, t) });
      segs.push({ dur: k === 2 ? 140 : 260, pose: (t) => ({ ...recupera(para(), v().dir, 1), P: QUADRIL + respira(t) }) });
    }
  }

  // Na A, como o abajur que amassa a letra: confere, pula de novo (amassa mais), confere,
  // pula mais alto (amassa mais), olha para quem está vendo e dá de ombros.
  segs.push({ dur: 650, pose: (t) => confere(topoA(), t, 1) });
  const pulinho = (subida: number, altura: number, lado: number, depois: number) => {
    const v = () => voo(topoA(), topoA(), R().cap, NaN, subida);
    segs.push({ dur: 260, pose: (t) => prepara(topoA(), 0, t, false) });
    segs.push({ dur: 100, pose: (t) => impulso(topoA(), 0, t, false) });
    segs.push({ dur: Math.round(Math.min(900, Math.max(360, v().T * 1000))), pose: (t) => noAr(v(), t) });
    segs.push({
      dur: 160,
      pose: (t) => pousa(topoA(), 0, t),
      ao: () => {
        poeira(topoA());
        impacto(altura);
      },
    });
    segs.push({ dur: depois, pose: (t) => (lado ? confere(topoA(), t, lado) : recupera(topoA(), 0, t)) });
  };
  pulinho(0.22, AMASSOS_A[1], -1, 520);
  pulinho(0.36, AMASSOS_A[2], 0, 420);
  segs.push({ dur: 1500, pose: (t) => deOmbros(topoA(), t) });

  segs.push({ dur: 1100, pose: (t) => sentar(topoA(), t), ao: () => reagir('senta') });
  segs.push({ dur: 2000, pose: (t) => puxarBaixo(topoA(), t) });
  return segs;
}

// ---------------------------------------------------------------------------
// A arte
// ---------------------------------------------------------------------------

/** Trastes: a distância de cada um até o pestana segue a escala real (2^(-n/12)). */
const PESTANA = -86;
const ESCALA_CORDA = 109;
const TRASTES = Array.from({ length: 18 }, (_, k) => PESTANA + ESCALA_CORDA * (1 - Math.pow(2, -(k + 1) / 12))).filter((x) => x < -15);
const meioDaCasa = (n: number) => (PESTANA + ESCALA_CORDA * (1 - Math.pow(2, -(n - 1) / 12)) + PESTANA + ESCALA_CORDA * (1 - Math.pow(2, -n / 12))) / 2;
const MARCACOES = [3, 5, 7, 9].map(meioDaCasa);
const MARCACAO_12 = meioDaCasa(12);
const TARRAXAS = [-91, -96, -101, -106];
const CORDAS = [-3.6, -1.2, 1.2, 3.6];

/**
 * Contrabaixo elétrico de 4 cordas (no espírito de um Precision): corpo com dois chifres,
 * braço longo com trastes e marcações, mão com as 4 tarraxas grandes do mesmo lado, captador
 * dividido + captador de ponte, ponte com 4 carrinhos e knobs. Centro do corpo em (0, 0),
 * braço para a esquerda.
 */
function Contrabaixo() {
  return (
    <g transform={`scale(${ESCALA_BAIXO})`}>
      {/* Mão (headstock) e tarraxas grandes, todas de um lado. */}
      {TARRAXAS.map((x) => (
        <g key={x}>
          <path className="n thin" d={`M${x} -4.5 L${x - 0.6} -8.5`} />
          <path d={`M${x - 3} -9 C${x - 3.4} -12 ${x + 1.8} -12.6 ${x + 1.8} -9.8 C${x + 1.6} -8 ${x - 2.6} -7.4 ${x - 3} -9 Z`} />
        </g>
      ))}
      <path className="a" d="M-86 -2.8 C-90 -3.6 -93 -6.6 -99 -7.2 C-104.5 -7.6 -108.5 -6 -109.5 -2.2 C-110.5 1.6 -107.5 4.4 -103 5 C-98 5.6 -92 4.2 -86 2.8 Z" />
      {TARRAXAS.map((x) => <circle key={'p' + x} className="k" cx={x} cy="-2.2" r="1.15" />)}
      {/* Braço com escala, trastes e marcações. */}
      <path d="M-14 -3.4 L-86 -2.6 L-86 2.6 L-14 3.4 Z" />
      <path className="n thin" d={TRASTES.map((x) => `M${x.toFixed(1)} -3 l0 6`).join(' ')} />
      {MARCACOES.map((x) => <circle key={x} className="k" cx={x.toFixed(1)} cy="0" r="0.95" />)}
      <circle className="k" cx={MARCACAO_12.toFixed(1)} cy="-1.4" r="0.95" />
      <circle className="k" cx={MARCACAO_12.toFixed(1)} cy="1.4" r="0.95" />
      <path className="n" d="M-86 -2.8 L-86 2.8" />
      {/* Corpo: chifre de cima maior que o de baixo, como um baixo de verdade. */}
      <path
        className="a"
        d="M-14 -3.4 C-16 -6 -20 -8 -23.5 -9.5 C-27.5 -11.5 -26.5 -16 -21 -16 C-13 -16 -6 -13.5 2 -15 C12 -17 26 -17.5 31 -8.5 C35 -1 34 8 29 12.5 C22 18 10 15.5 3 16 C-4 16.5 -12 17 -17 13.5 C-21 11 -21 7.5 -18 6.5 C-16.5 5.2 -15 4.2 -14 3.4 Z"
      />
      {/* Escudo, captadores, apoio de polegar, ponte, knobs. */}
      <path className="bx-escudo" d="M-14 -3.4 C-17 -6.5 -21 -9 -22.5 -11.5 C-23 -14 -19 -14.5 -14 -13.6 C-8 -12.6 -2 -12 4 -12.5 C8 -12.8 10 -10 10 -6 L10 6 C10 10 7 12 2 12 C-5 12.4 -10 11.5 -14 9.5 C-16 8 -15.5 5.5 -14 3.4 Z" />
      <rect className="k" x="-3" y="-6.4" width="4.2" height="6.6" rx="1.2" />
      <rect className="k" x="0.8" y="-0.4" width="4.2" height="6.6" rx="1.2" />
      <rect className="k" x="13" y="-5.8" width="3.6" height="11.6" rx="1.4" />
      <rect x="-1" y="-10.8" width="7" height="2" rx="1" />
      <rect x="21" y="-5.6" width="4.4" height="11.2" rx="0.8" />
      {CORDAS.map((y) => <rect key={'s' + y} className="k" x="22.2" y={y - 0.7} width="2.2" height="1.4" rx="0.3" />)}
      <circle cx="18" cy="11" r="1.9" />
      <circle cx="23.5" cy="9.6" r="1.9" />
      <circle cx="28" cy="7.4" r="1.9" />
      {/* As 4 cordas (as graves mais grossas), da ponte até as tarraxas. */}
      {CORDAS.map((y, i) => (
        <path
          key={'c' + y}
          className="n bx-corda"
          style={{ strokeWidth: 0.95 - i * 0.14 }}
          d={`M23.3 ${y} L${PESTANA} ${(y * 0.75).toFixed(2)} L${TARRAXAS[i]} -2.2`}
        />
      ))}
      <circle className="k" cx="-23.8" cy="-15.2" r="1.2" />
      <circle className="k" cx="33.4" cy="2" r="1.2" />
    </g>
  );
}

function Nota({ dupla }: { dupla?: boolean }) {
  return dupla ? (
    <>
      <ellipse className="k" cx="0" cy="0" rx="3.4" ry="2.5" transform="rotate(-20)" />
      <ellipse className="k" cx="11" cy="-3" rx="3.4" ry="2.5" transform="rotate(-20 11 -3)" />
      <path className="n" d="M3 -1 L3 -15 M14 -4 L14 -18" />
      <path className="k bx-viga" d="M3 -15 L14 -18 L14 -15 L3 -12 Z" />
    </>
  ) : (
    <>
      <ellipse className="k" cx="0" cy="0" rx="3.4" ry="2.5" transform="rotate(-20)" />
      <path className="n" d="M3 -1 L3 -16 C7 -14 9.5 -11 7.5 -6.5" />
    </>
  );
}

/** Notas ao redor dele (coordenadas do corpo sentado). */
const NOTAS: { x: number; y: number; dx: number; atraso: number; dupla?: boolean }[] = [
  { x: 30, y: -44, dx: 14, atraso: 0 },
  { x: -36, y: -60, dx: -12, atraso: 1.3, dupla: true },
  { x: 30, y: -74, dx: 10, atraso: 2.6 },
  { x: -18, y: -90, dx: -8, atraso: 3.9 },
];

const TEE = 'M-17 -35 C-12 -38.5 12 -38.5 17 -35 C19.5 -27 19.2 -12 18.2 1 C10 3.6 -10 3.6 -18.2 1 C-19.2 -12 -19.5 -27 -17 -35 Z';
const MANGA_E = 'M-17 -35 C-23.5 -33 -27 -27 -26 -20.5 L-18.4 -19 C-18.8 -24.5 -18.8 -30 -17 -35 Z';
const MANGA_D = 'M17 -35 C23.5 -33 27 -27 26 -20.5 L18.4 -19 C18.8 -24.5 18.8 -30 17 -35 Z';

type Pecas = {
  raiz: SVGGElement | null;
  corpo: SVGGElement | null;
  perna: (SVGPathElement | null)[];
  pernaMiolo: (SVGPathElement | null)[];
  pe: (SVGGElement | null)[];
  tronco: SVGGElement | null;
  braco: (SVGPathElement | null)[];
  bracoMiolo: (SVGPathElement | null)[];
  tatuagem: SVGPathElement | null;
  mao: (SVGCircleElement | null)[];
  cabeca: SVGGElement | null;
  rosto: SVGGElement | null;
  pupilas: SVGGElement | null;
  olhosAbertos: SVGGElement | null;
  olhosFelizes: SVGGElement | null;
  baixoCostas: SVGGElement | null;
  baixoFrente: SVGGElement | null;
  poeira: SVGGElement | null;
};

function aplicar(p: Pecas, q: Pose, escala: number) {
  if (!p.raiz) return;
  p.raiz.style.opacity = '1';
  p.raiz.setAttribute('transform', `translate(${num(q.x)} ${num(q.y)}) scale(${num(escala)})`);
  p.corpo?.setAttribute('transform', `rotate(${num(q.inclina)} 0 ${num(-q.P)})`);

  for (let i = 0; i < 2; i++) {
    const quadril = { x: JUNTA_PERNA[i].x, y: -q.P + JUNTA_PERNA[i].y };
    const perna = mangueira(quadril, q.pes[i], PERNA, { x: i ? 1 : -1, y: 0.25 });
    p.perna[i]?.setAttribute('d', perna.d);
    p.pernaMiolo[i]?.setAttribute('d', perna.d);
    p.pe[i]?.setAttribute('transform', `translate(${num(q.pes[i].x)} ${num(q.pes[i].y)})${i ? ' scale(-1 1)' : ''}`);

    const mao = alcance(OMBRO[i], q.maos[i], BRACO);
    const braco = mangueira(OMBRO[i], mao, BRACO, { x: i ? 0.6 : -0.6, y: 0.8 });
    p.braco[i]?.setAttribute('d', braco.d);
    p.bracoMiolo[i]?.setAttribute('d', braco.d);
    p.mao[i]?.setAttribute('cx', num(mao.x));
    p.mao[i]?.setAttribute('cy', num(mao.y));
    if (i === 0 && p.tatuagem) {
      // Só o antebraço: o trecho da curva entre o meio e perto da mão.
      const m = { x: 0.25 * braco.a.x + 0.5 * braco.c.x + 0.25 * braco.b.x, y: 0.25 * braco.a.y + 0.5 * braco.c.y + 0.25 * braco.b.y };
      const c = lerpV(braco.c, braco.b, 0.5);
      const fim = lerpV(c, braco.b, 0.7);
      p.tatuagem.setAttribute('d', `M${num(m.x)} ${num(m.y)}Q${num(c.x)} ${num(c.y)} ${num(fim.x)} ${num(fim.y)}`);
    }
  }

  p.tronco?.setAttribute('transform', `translate(0 ${num(-q.P)}) scale(${num(q.sx)} ${num(q.sy)})`);
  p.cabeca?.setAttribute('transform', `translate(0 ${CABECA_Y}) rotate(${num(q.cabeca)})`);
  p.rosto?.setAttribute('transform', `translate(${num(q.olhar.x * 0.7)} ${num(q.olhar.y * 0.45)})`);
  p.pupilas?.setAttribute('transform', `translate(${num(q.olhar.x * 0.5)} ${num(q.olhar.y * 0.45)})`);
  if (p.olhosAbertos) p.olhosAbertos.style.opacity = q.feliz > 0.5 ? '0' : '1';
  if (p.olhosFelizes) p.olhosFelizes.style.opacity = q.feliz > 0.5 ? '1' : '0';

  const bx = baixoEm(q.baixo);
  const tb = `translate(${num(bx.x)} ${num(bx.y)}) rotate(${num(bx.r)})`;
  p.baixoCostas?.setAttribute('transform', tb);
  p.baixoFrente?.setAttribute('transform', tb);
  if (p.baixoCostas) p.baixoCostas.style.opacity = q.baixo < 0.5 ? '1' : '0';
  if (p.baixoFrente) p.baixoFrente.style.opacity = q.baixo < 0.5 ? '0' : '1';
}

/**
 * O baixista dentro do SVG da logo. `iniciar` vira true quando a história deve começar;
 * `reduzido` (prefers-reduced-motion) pula direto para o estado final, parado.
 */
export function Baixista({ roteiro: r, iniciar, reduzido, hatch, onReacao, amassarA }: {
  roteiro: RoteiroBaixista;
  iniciar: boolean;
  reduzido: boolean;
  hatch: string;
  onReacao: (r: ReacaoBx) => void;
  /** Amassa a letra A (largura e altura relativas, a partir da base). */
  amassarA?: (sx: number, sy: number) => void;
}) {
  const pecas = React.useRef<Pecas>({
    raiz: null, corpo: null, perna: [null, null], pernaMiolo: [null, null], pe: [null, null], tronco: null,
    braco: [null, null], bracoMiolo: [null, null], tatuagem: null, mao: [null, null], cabeca: null, rosto: null,
    pupilas: null, olhosAbertos: null, olhosFelizes: null, baixoCostas: null, baixoFrente: null, poeira: null,
  });
  const [tocando, setTocando] = React.useState(false);
  const reagir = React.useRef(onReacao);
  const roteiroRef = React.useRef(r);
  const amassar = React.useRef(amassarA);
  React.useEffect(() => {
    reagir.current = onReacao;
    roteiroRef.current = r;
    amassar.current = amassarA;
  }, [onReacao, r, amassarA]);

  // Com movimento reduzido, o estado final acompanha a letra A se a tela mudar de tamanho.
  React.useEffect(() => {
    if (!tocando || !reduzido) return;
    const a = r.apoios[r.apoios.length - 1];
    aplicar(pecas.current, tocar({ x: a.x, y: a.y * ALTURA_FINAL_A }, 0), r.escala);
  }, [tocando, reduzido, r]);

  React.useEffect(() => {
    if (!iniciar) return;
    const p = pecas.current;
    const R = () => roteiroRef.current;
    // A letra A: altura atual e o amasso em curso (passa um pouco e volta, como massinha).
    let alturaA = 1;
    let amasso: { t0: number; de: number; para: number } | null = null;
    let relogio = 0;
    const largura = (h: number) => 1 + (1 - h) * 0.18;
    const impacto = (para: number) => { amasso = { t0: relogio, de: alturaA, para }; };
    const atualizaA = () => {
      if (!amasso) return;
      const u = clamp01((relogio - amasso.t0) / 460);
      alturaA = u >= 1 ? amasso.para : lerp(amasso.de, amasso.para, mola(u));
      amassar.current?.(largura(alturaA), alturaA);
      if (u >= 1) amasso = null;
    };
    const pontoA = (): V => {
      const a = R().apoios[R().apoios.length - 1];
      return { x: a.x, y: a.y * alturaA };
    };

    if (reduzido) {
      const id = requestAnimationFrame(() => {
        alturaA = ALTURA_FINAL_A;
        amassar.current?.(largura(alturaA), alturaA);
        reagir.current('voa');
        reagir.current('senta');
        reagir.current('toca');
        setTocando(true);
        aplicar(p, tocar(pontoA(), 0), R().escala);
      });
      return () => cancelAnimationFrame(id);
    }

    // Só anima com o rodapé na tela e a aba visível.
    let visivel = true;
    const svg = p.raiz?.ownerSVGElement;
    const io = svg ? new IntersectionObserver((e) => { visivel = e.some((x) => x.isIntersecting); }) : null;
    if (svg && io) io.observe(svg);

    const poeira = (pt: V) => {
      const el = p.poeira;
      if (!el) return;
      el.setAttribute('transform', `translate(${num(pt.x)} ${num(pt.y)}) scale(${num(R().escala)})`);
      el.classList.remove('is-on');
      void el.getBoundingClientRect();
      el.classList.add('is-on');
    };
    const segs = montarRoteiro(R, (x) => reagir.current(x), poeira, () => alturaA, impacto);

    let indice = 0;
    let dentro = 0;
    let disparado = -1;
    let final = 0; // segundos no estado final
    let ultimo = performance.now();
    let pintadoEm = 0;
    let raf = 0;
    const quadro = (agora: number) => {
      raf = requestAnimationFrame(quadro);
      const parado = document.hidden || !visivel;
      // O relógio só anda com o rodapé visível: a história não "pula" enquanto ninguém vê.
      const dt = parado ? 0 : Math.min(250, agora - ultimo);
      ultimo = agora;
      if (parado) return;
      relogio += dt;
      atualizaA();
      if (indice < segs.length) {
        dentro += dt;
        while (indice < segs.length && dentro >= segs[indice].dur) {
          if (disparado < indice) { segs[indice].ao?.(); disparado = indice; }
          dentro -= segs[indice].dur;
          indice++;
        }
        if (indice < segs.length) {
          if (disparado < indice) { segs[indice].ao?.(); disparado = indice; }
          aplicar(p, segs[indice].pose(clamp01(dentro / segs[indice].dur)), R().escala);
          return;
        }
        reagir.current('toca');
        setTocando(true);
      }
      // Estado final: tocando para sempre, a ~30 quadros por segundo.
      final += dt / 1000;
      if (agora - pintadoEm < 32) return;
      pintadoEm = agora;
      aplicar(p, tocar(pontoA(), final), R().escala);
    };
    raf = requestAnimationFrame(quadro);
    return () => {
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, [iniciar, reduzido]);

  return (
    <>
      <g ref={(el) => void (pecas.current.raiz = el)} className="dcf-bx" style={{ opacity: 0 }}>
        <g className="dcf-art dcf-bx-art">
          <g ref={(el) => void (pecas.current.corpo = el)}>
            {/* Pernas de mangueira (jeans) e tênis. */}
            {[0, 1].map((i) => (
              <g key={'perna' + i}>
                <path ref={(el) => void (pecas.current.perna[i] = el)} className="bx-perna" />
                <path ref={(el) => void (pecas.current.pernaMiolo[i] = el)} className="bx-perna-miolo" />
              </g>
            ))}
            {[0, 1].map((i) => (
              <g key={'pe' + i} ref={(el) => void (pecas.current.pe[i] = el)}>
                <path className="k" d="M-8 -2.5 C-9.5 3 -6.5 6.5 -1 6.5 L4 6.5 C9 6.5 9.5 1 6.5 -2.5 Z" />
                <path className="bx-sola" d="M-7 3.6 L7.5 3.6" />
              </g>
            ))}

            <g ref={(el) => void (pecas.current.tronco = el)}>
              {/* O baixo nas costas, atrás do tronco, com a mão do instrumento passando do ombro direito. */}
              <g ref={(el) => void (pecas.current.baixoCostas = el)}>
                <Contrabaixo />
              </g>
              {/* Cós da calça (cobre a raiz das pernas). */}
              <path d="M-17 -1 L17 -1 L16 6 L-16 6 Z" />
              <path className="n thin" d="M-3 0 L-3 6" />
              {/* Camiseta preta (hachurada como as sombras da turma) com estampa de banda. */}
              <path d={TEE} />
              <path d={TEE} fill={hatch} stroke="none" />
              <path className="bx-estampa-fundo" d="M-9.5 -26 L9.5 -26 L9 -15.5 L-9 -15.5 Z" />
              <path className="n thin bx-estampa" d="M-8 -18.5 l1.4 -5 l1.4 4 l1.4 -5 l1.4 5 l1.4 -4 l1.4 5 l1.4 -5 l1.4 4 l1.4 -4 M-7 -17 L7 -17" />
              <path className="n" d="M-6 -37 C-3 -33.5 3 -33.5 6 -37" />
              <path className="n thick bx-correia" d="M15 -35 C8 -25 -6 -10 -14 -1" />

              <g ref={(el) => void (pecas.current.baixoFrente = el)} style={{ opacity: 0 }}>
                <Contrabaixo />
              </g>

              {/* Braços de mangueira; o esquerdo tem tatuagem no antebraço. */}
              {[0, 1].map((i) => (
                <g key={'braco' + i}>
                  <path ref={(el) => void (pecas.current.braco[i] = el)} className="bx-braco" />
                  <path ref={(el) => void (pecas.current.bracoMiolo[i] = el)} className="bx-braco-miolo" />
                </g>
              ))}
              <path ref={(el) => void (pecas.current.tatuagem = el)} className="bx-tatuagem" />
              <path d={MANGA_E} />
              <path d={MANGA_E} fill={hatch} stroke="none" />
              <path d={MANGA_D} />
              <path d={MANGA_D} fill={hatch} stroke="none" />
              {[0, 1].map((i) => (
                <circle key={'mao' + i} ref={(el) => void (pecas.current.mao[i] = el)} r="4.6" cx={MAOS_REPOUSO[i].x} cy={MAOS_REPOUSO[i].y} />
              ))}

              {/* Cabeça: orelhas, rosto, barba e cabelo loiros. */}
              <g ref={(el) => void (pecas.current.cabeca = el)} transform={`translate(0 ${CABECA_Y})`}>
                <circle cx="-16.2" cy="1" r="4.2" />
                <circle cx="16.2" cy="1" r="4.2" />
                <ellipse cx="0" cy="0" rx="16.5" ry="17.5" />
                <path className="bx-barba" d="M-16.5 -3 C-18.5 11 -10 21 0 21 C10 21 18.5 11 16.5 -3 C14.5 3 11 7 6.5 7.5 C3.5 5.5 -3.5 5.5 -6.5 7.5 C-11 7 -14.5 3 -16.5 -3 Z" />
                <path className="n thin bx-fio" d="M-12 6 l1.6 3.2 M-8 12 l1 3 M8 12 l-1 3 M12 6 l-1.6 3.2 M-3 15.5 l0 2.6 M3 15.5 l0 2.6" />
                <g ref={(el) => void (pecas.current.rosto = el)}>
                  <path className="k" d="M-4.2 8.6 C-2.6 12.8 2.6 12.8 4.2 8.6 C1.5 9.6 -1.5 9.6 -4.2 8.6 Z" />
                  <path className="bx-barba" d="M-8.5 6.5 C-5.5 3 -1.8 3.6 0 5 C1.8 3.6 5.5 3 8.5 6.5 C5.5 8 2 7.6 0 6.8 C-2 7.6 -5.5 8 -8.5 6.5 Z" />
                  <path className="n thin" d="M0.6 -3 C-1.2 0.5 -0.6 2.4 2 2" />
                  <g ref={(el) => void (pecas.current.olhosAbertos = el)}>
                    <g className="bx-pisca">
                      <circle className="bx-olho" cx="-6" cy="-5" r="4.3" />
                      <circle className="bx-olho" cx="6" cy="-5" r="4.3" />
                      <g ref={(el) => void (pecas.current.pupilas = el)}>
                        <circle className="k" cx="-6" cy="-5" r="2" />
                        <circle className="k" cx="6" cy="-5" r="2" />
                        <circle className="dcf-glint" cx="-5.3" cy="-5.8" r="0.7" />
                        <circle className="dcf-glint" cx="6.7" cy="-5.8" r="0.7" />
                      </g>
                    </g>
                  </g>
                  <g ref={(el) => void (pecas.current.olhosFelizes = el)} style={{ opacity: 0 }}>
                    <path className="n" d="M-9.8 -4.2 C-8.3 -7.8 -3.9 -7.8 -2.4 -4.2 M2.4 -4.2 C3.9 -7.8 8.3 -7.8 9.8 -4.2" />
                  </g>
                  <path className="n bx-sobrancelha" d="M-10.5 -11.2 C-8.5 -13.4 -4.5 -13.4 -2.5 -11.8 M2.5 -11.8 C4.5 -13.4 8.5 -13.4 10.5 -11.2" />
                </g>
                <path className="bx-cabelo" d="M-16.6 -2 C-19.5 -15 -13.5 -26.5 -2 -27.5 C3 -31.5 13 -30.5 15 -24.5 C19.8 -19.5 19.5 -9 16.6 -2 C15.6 -8.5 12.5 -12.5 8.5 -13 C5.5 -17.5 -1.5 -18.5 -5.5 -14.5 C-9.5 -15.5 -14.5 -11.5 -16.6 -2 Z" />
                <path className="n thin bx-fio" d="M-9 -22 C-5 -19.5 0 -19.5 5 -23 M-13.5 -15.5 C-10 -18 -6.5 -19 -3 -18.5 M4 -19.5 C8 -19.5 11.5 -17.5 13.5 -14" />
              </g>
            </g>
          </g>

          {/* Notas: só no estado final, subindo e sumindo devagar. */}
          {tocando && (
            <g className="dcf-bx-notas">
              {NOTAS.map((n, k) => (
                <g key={k} transform={`translate(${n.x} ${n.y})`}>
                  <g className="dcf-bx-nota" style={{ '--dx': n.dx + 'px', animationDelay: n.atraso + 's' } as React.CSSProperties}>
                    <Nota dupla={n.dupla} />
                  </g>
                </g>
              ))}
            </g>
          )}
        </g>
      </g>

      {/* Poeira do pouso (no espaço da logo, reposicionada a cada aterrissagem). */}
      <g ref={(el) => void (pecas.current.poeira = el)} className="dcf-bx-poeira" aria-hidden="true">
        <path d="M-13 -1 l-9 -2 M-11 -5 l-7 -7 M13 -1 l9 -2 M11 -5 l7 -7" />
        <circle cx="-20" cy="-9" r="1.6" />
        <circle cx="21" cy="-8" r="1.3" />
      </g>
    </>
  );
}

/** As peças de CSS do baixista e das reações da turma (entram no <style> do rodapé). */
export const CSS_BAIXISTA =
  '.dcf-svg{overflow:visible}' +
  '.dcf-bx,.dcf-bx-poeira{pointer-events:none}' +
  '.dcf-art .bx-perna{fill:none;stroke-width:13.5}.dcf-art .bx-perna-miolo{fill:none;stroke:var(--dcf-bg);stroke-width:8.5}' +
  '.dcf-art .bx-braco{fill:none;stroke-width:11}.dcf-art .bx-braco-miolo{fill:none;stroke:var(--dcf-bg);stroke-width:6}.dcf-art .bx-escudo{stroke-width:1.8}' +
  '.dcf-art .bx-tatuagem{fill:none;stroke-width:1.3;stroke-dasharray:2.2 2;stroke-linecap:butt}' +
  '.dcf-art .bx-sola{fill:none;stroke:var(--dcf-bg);stroke-width:1.2}' +
  '.dcf-art .bx-cabelo{fill:#f3c34f}.dcf-art .bx-barba{fill:#e2a63a}' +
  '.dcf-art .bx-fio{stroke:#b9781c}.dcf-art .bx-sobrancelha{stroke:#c98a24;stroke-width:2.6}' +
  '.dcf-art .bx-olho{stroke-width:1.8}' +
  '.dcf-art .bx-estampa-fundo{fill:var(--dcf-ink);stroke:none}.dcf-art .bx-estampa{stroke:var(--dcf-bg)}' +
  '.dcf-art .bx-corda{fill:none;opacity:.85}.dcf-art .bx-viga{stroke-width:1}' +
  '.bx-pisca{transform-box:fill-box;transform-origin:50% 50%;animation:dcf-bx-pisca 4.6s infinite}' +
  '.dcf-bx-nota{transform-box:fill-box;transform-origin:50% 50%;opacity:0;animation:dcf-bx-nota 5.2s ease-out infinite}' +
  '.dcf-bx-nota .k{fill:var(--dcf-ink)}' +
  '.dcf-bx-poeira path{fill:none;stroke:var(--dcf-ink);stroke-width:2.6;stroke-linecap:round}' +
  '.dcf-bx-poeira circle{fill:var(--dcf-bg);stroke:var(--dcf-ink);stroke-width:1.4}' +
  '.dcf-bx-poeira{opacity:0}.dcf-bx-poeira.is-on{animation:dcf-bx-poeira .55s ease-out forwards}' +
  '.dcf-bx-poeira.is-on path{animation:dcf-bx-risco .55s ease-out forwards}' +
  // Reações da turma.
  '.dcf-react{transform-box:fill-box;transform-origin:50% 100%;transition:transform .35s cubic-bezier(.3,.9,.4,1),opacity .35s}' +
  '.dcf-react.is-agacha{animation:dcf-bx-agacha 1.1s cubic-bezier(.3,.8,.4,1)}' +
  '.dcf-react.is-afunda{transform:translateY(44px)}' +
  '.dcf-react.is-voa{animation:dcf-bx-voa 2.1s cubic-bezier(.45,.05,.55,1) forwards}' +
  '.dcf-react.is-voou{opacity:0;visibility:hidden}' +
  '.dcf-asas{opacity:0}.dcf-react.is-voa .dcf-asas{animation:dcf-bx-asas-in 2.1s linear forwards}' +
  '.dcf-asa{transform-box:fill-box}.dcf-asa-e{transform-origin:100% 100%}.dcf-asa-d{transform-origin:0 100%}' +
  '.dcf-react.is-voa .dcf-asa-e{animation:dcf-bx-bate-e .16s ease-in-out infinite alternate}' +
  '.dcf-react.is-voa .dcf-asa-d{animation:dcf-bx-bate-d .16s ease-in-out infinite alternate}' +
  '@keyframes dcf-bx-pisca{0%,93%,100%{transform:none}95%{transform:scaleY(.1)}}' +
  '@keyframes dcf-bx-nota{0%{opacity:0;transform:translate(0,0) rotate(-10deg) scale(.6)}12%{opacity:.95}70%{opacity:.7}100%{opacity:0;transform:translate(var(--dx),-48px) rotate(14deg) scale(1)}}' +
  '@keyframes dcf-bx-poeira{0%{opacity:0}15%{opacity:1}100%{opacity:0}}' +
  '@keyframes dcf-bx-risco{0%{stroke-dasharray:0 30;stroke-dashoffset:0}100%{stroke-dasharray:8 30;stroke-dashoffset:-10}}' +
  '@keyframes dcf-bx-agacha{0%,100%{transform:none}25%{transform:scale(1.08,.86)}50%{transform:scale(1.12,.72)}75%{transform:scale(1.04,.9)}}' +
  // O passarinho: susto (pulinho), abre as asas, decola em arco para cima e para fora da logo.
  '@keyframes dcf-bx-voa{0%{transform:none}8%{transform:translateY(-6px) scale(.94,1.08)}14%{transform:scale(1.08,.9)}24%{transform:translateY(-2px)}40%{transform:translate(-30px,-60px) rotate(-8deg)}70%{transform:translate(-140px,-170px) rotate(-14deg);opacity:1}100%{transform:translate(-260px,-290px) rotate(-18deg) scale(.8);opacity:0}}' +
  '@keyframes dcf-bx-asas-in{0%,16%{opacity:0}22%,100%{opacity:1}}' +
  '@keyframes dcf-bx-bate-e{from{transform:rotate(18deg)}to{transform:rotate(-30deg)}}' +
  '@keyframes dcf-bx-bate-d{from{transform:rotate(-18deg)}to{transform:rotate(30deg)}}';

/** Asas do passarinho (nas unidades da arte dele), abertas só quando ele voa. */
export function AsasDoPassarinho() {
  return (
    <g className="dcf-asas">
      <path className="dcf-asa dcf-asa-e" d="M-6 -26 C-18 -44 -34 -46 -40 -38 C-30 -36 -20 -31 -8 -21 Z" />
      <path className="dcf-asa dcf-asa-d" d="M6 -27 C16 -47 31 -50 37 -42 C27 -39 18 -32 9 -21 Z" />
    </g>
  );
}
