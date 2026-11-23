// Para onde voltar depois do login (?voltar=...): só caminhos deste app.
// Resolve o endereço de verdade e compara a origem, porque "/\site", "/%09/site" e afins
// passam numa checagem de texto ("começa com / e não com //") e o navegador os trata como outro site.

const PADRAO = "/";

export function caminhoSeguro(v: string | null | undefined, origem: string): string {
  if (!v || !v.startsWith("/") || /[\\\s\u0000-\u001f\u007f]/.test(v)) return PADRAO;
  try {
    const u = new URL(v, origem);
    if (u.origin !== new URL(origem).origin) return PADRAO;
    if (u.pathname.startsWith("/api/") || u.pathname.startsWith("/entrar") || u.pathname.startsWith("/convite")) return PADRAO;
    return u.pathname + u.search;
  } catch {
    return PADRAO;
  }
}
