// Senhas e tokens. Só roda no servidor (a cifra fica em ./cifra, que o proxy também usa).


import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export { cifrar, decifrar, type Finalidade } from "./cifra";

// ---------------------------------------------------------------- senha (scrypt)
// N=2^15, r=8, p=1: ~32 MB e ~100 ms por tentativa. Formato: scrypt$N$r$p$sal$hash

const N = 32768;
const R = 8;
const P = 1;
const TAMANHO = 32;

function derivar(senha: string, sal: Buffer, n = N, r = R, p = P): Promise<Buffer> {
  return new Promise((ok, erro) =>
    scrypt(senha.normalize("NFKC"), sal, TAMANHO, { N: n, r, p, maxmem: 128 * n * r * 2 }, (e, chave) => (e ? erro(e) : ok(chave))),
  );
}

export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const h = await derivar(senha, sal);
  return ["scrypt", N, R, P, sal.toString("base64url"), h.toString("base64url")].join("$");
}

// Hash de uma senha qualquer, para gastar o mesmo tempo quando o e-mail não existe.
let hashFalso: Promise<string> | null = null;

export async function conferirSenha(senha: string, guardado: string | null | undefined): Promise<boolean> {
  hashFalso ??= hashSenha(randomBytes(12).toString("base64url"));
  const alvo = guardado || (await hashFalso);
  const [tipo, n, r, p, sal, h] = alvo.split("$");
  if (tipo !== "scrypt" || !sal || !h) return false;
  const calculado = await derivar(senha, Buffer.from(sal, "base64url"), Number(n), Number(r), Number(p));
  const esperado = Buffer.from(h, "base64url");
  return !!guardado && esperado.length === calculado.length && timingSafeEqual(esperado, calculado);
}

// ---------------------------------------------------------------- tokens

export function tokenAleatorio(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

/** Guardamos só o hash dos tokens de convite: quem lê o banco não consegue usá-los. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
