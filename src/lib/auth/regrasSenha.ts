// Regra de senha forte, igual à do Bate Lastro (backend/utils/password_utils.py e
// frontend/src/utils/regrasSenha.js). Roda na tela (para liberar o botão) e no servidor
// (que é quem decide), com o mesmo código.

// Mesmo conjunto do string.punctuation do Python.
const SIMBOLOS = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";

// Array.from percorre por caractere (code point), como o Python.
function temSequenciaOuRepeticao(senha: string): boolean {
  const chars = Array.from(senha.toLowerCase());
  for (let i = 0; i + 2 < chars.length; i++) {
    const trio = chars.slice(i, i + 3).join("");
    const [a, b, c] = chars.slice(i, i + 3).map((ch) => ch.codePointAt(0)!);
    if (a === b && b === c) return true;
    if (b - a === c - b && Math.abs(b - a) === 1 && /^([0-9]{3}|[a-z]{3})$/.test(trio)) return true;
  }
  return false;
}

export interface AvaliacaoSenha {
  tamanho: boolean;
  maiuscula: boolean;
  minuscula: boolean;
  numero: boolean;
  simbolo: boolean;
  semSequencia: boolean;
}

export function avaliarSenha(senha: string): AvaliacaoSenha {
  return {
    tamanho: Array.from(senha).length >= 12,
    maiuscula: /[A-Z]/.test(senha),
    minuscula: /[a-z]/.test(senha),
    numero: /[0-9]/.test(senha),
    simbolo: Array.from(senha).some((ch) => SIMBOLOS.includes(ch)),
    semSequencia: senha.length > 0 && !temSequenciaOuRepeticao(senha),
  };
}

export const ROTULOS_SENHA: Record<keyof AvaliacaoSenha, string> = {
  tamanho: "Pelo menos 12 caracteres",
  maiuscula: "Uma letra maiúscula",
  minuscula: "Uma letra minúscula",
  numero: "Um número",
  simbolo: "Um símbolo (! @ # $ …)",
  semSequencia: "Sem 3 iguais ou em sequência (aaa, 123, abc)",
};

/** Mensagem do primeiro requisito que falta, ou null se a senha serve. */
export function problemaNaSenha(senha: string): string | null {
  if (Array.from(senha).length > 128) return "A senha pode ter no máximo 128 caracteres.";
  const a = avaliarSenha(senha);
  const falta = (Object.keys(a) as (keyof AvaliacaoSenha)[]).find((k) => !a[k]);
  return falta ? `Senha fraca: ${ROTULOS_SENHA[falta].toLowerCase()}.` : null;
}
