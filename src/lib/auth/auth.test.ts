import { describe, expect, it } from "vitest";

import { abrir as abrirSessao, selar } from "./sessao";
import { caminhoSeguro } from "./caminho";
import { cifrar, decifrar } from "./cifra";
import { emailPermitido } from "./config";
import { conferirSenha, hashSenha, hashToken } from "./cripto";
import { abrirDesafio, selarDesafio } from "./desafio";
import { avaliarSenha, problemaNaSenha, type AvaliacaoSenha } from "./regrasSenha";
import { base32, codigo, conferirCodigo, deBase32, gerarSegredo, passoAtual, uriOtpauth } from "./totp";
import { abrirSessaoNaConta, acharPorConvite, novoConvite, situacao, type Usuario } from "./usuarios";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!";
const OUTRO = "outro-segredo-com-mais-de-32-caracteres!!!";

describe("cookie de sessão", () => {
  const s = { v: 2 as const, email: "ana@denvercontabil.com.br", sid: "abc123", visto: Date.now() };

  it("sela e abre de volta", () => {
    expect(abrirSessao(selar(s, SEGREDO), SEGREDO)).toEqual(s);
  });

  it("recusa cookie adulterado, com outro segredo ou de outra finalidade", () => {
    const selado = selar(s, SEGREDO);
    const adulterado = selado.slice(0, -4) + (selado.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(abrirSessao(adulterado, SEGREDO)).toBeNull();
    expect(abrirSessao(selado, OUTRO)).toBeNull();
    expect(abrirSessao(cifrar(JSON.stringify(s), SEGREDO, "desafio"), SEGREDO)).toBeNull();
    expect(abrirSessao("lixo", SEGREDO)).toBeNull();
    expect(abrirSessao(undefined, SEGREDO)).toBeNull();
  });

  it("vence depois de 30 dias sem uso", () => {
    const agora = Date.now();
    expect(abrirSessao(selar({ ...s, visto: agora - 29 * 86_400_000 }, SEGREDO), SEGREDO, agora)).not.toBeNull();
    expect(abrirSessao(selar({ ...s, visto: agora - 31 * 86_400_000 }, SEGREDO), SEGREDO, agora)).toBeNull();
  });
});

describe("cifra por finalidade", () => {
  it("só abre com o mesmo segredo e a mesma finalidade", () => {
    const c = cifrar("JBSWY3DPEHPK3PXP", SEGREDO, "totp");
    expect(decifrar(c, SEGREDO, "totp")).toBe("JBSWY3DPEHPK3PXP");
    expect(decifrar(c, SEGREDO, "sessao")).toBeNull();
    expect(decifrar(c, OUTRO, "totp")).toBeNull();
    expect(decifrar(c, "", "totp")).toBeNull();
  });
});

describe("desafio do segundo passo", () => {
  it("vale 3 minutos", () => {
    const agora = Date.now();
    const d = { email: "ana@denvercontabil.com.br", exp: agora + 180_000, n: "x1" };
    expect(abrirDesafio(selarDesafio(d, SEGREDO), SEGREDO, agora)).toEqual(d);
    expect(abrirDesafio(selarDesafio(d, SEGREDO), SEGREDO, agora + 181_000)).toBeNull();
  });
});

describe("quem pode ter conta", () => {
  it("aceita só o domínio da Denver por padrão", () => {
    expect(emailPermitido("ana@denvercontabil.com.br", {})).toBe(true);
    expect(emailPermitido("ANA@DenverContabil.com.br", {})).toBe(true);
    expect(emailPermitido("fulano@outra-instituicao.com.br", {})).toBe(false);
    expect(emailPermitido("sem-arroba", {})).toBe(false);
    expect(emailPermitido("a b@denvercontabil.com.br", {})).toBe(false);
    expect(emailPermitido(null, {})).toBe(false);
  });

  it("aceita e-mails avulsos e outros domínios configurados", () => {
    const env = { ACESSO_DOMINIOS: "denvercontabil.com.br, exemplo.com.br", ACESSO_EMAILS: "convidado@gmail.com" };
    expect(emailPermitido("x@exemplo.com.br", env)).toBe(true);
    expect(emailPermitido("convidado@gmail.com", env)).toBe(true);
    expect(emailPermitido("outro@gmail.com", env)).toBe(false);
  });
});

// Mesmos casos de frontend/src/utils/regrasSenha.test.js e backend/tests/test_password_policy.py do Bate Lastro.
describe("regra de senha (igual à do Bate Lastro)", () => {
  const ACEITAS = ["Bm#7kQ9pLz2r", "Minha_Senha-Forte9", "Xy`7kQ9pLz2r~", "Bm#$%kQ9pLz2r"];
  const RECUSADAS: Record<string, keyof AvaliacaoSenha> = {
    "Bm#7kQ9pLz2": "tamanho",
    "bm#7kq9plz2r": "maiuscula",
    "BM#7KQ9PLZ2R": "minuscula",
    "Bm#xkQypLz_r": "numero",
    Bm77kQ9pLz2r: "simbolo",
    "Rq#9vLmnTz2k": "semSequencia",
    "Bm#7kQ9pLz2r456": "semSequencia",
    "Bm#7kQ9pLzzzr": "semSequencia",
  };

  it.each(ACEITAS)("aceita %s", (senha) => {
    expect(Object.values(avaliarSenha(senha)).every(Boolean)).toBe(true);
    expect(problemaNaSenha(senha)).toBeNull();
  });

  it.each(Object.entries(RECUSADAS))("recusa %s pela regra %s", (senha, regra) => {
    expect(avaliarSenha(senha)[regra]).toBe(false);
    expect(problemaNaSenha(senha)).not.toBeNull();
  });

  it("não marca 'sem sequência' com o campo vazio", () => {
    expect(avaliarSenha("").semSequencia).toBe(false);
  });
});

describe("senha guardada (scrypt)", () => {
  it("confere a senha certa e recusa a errada ou a conta sem senha", async () => {
    const h = await hashSenha("Bm#7kQ9pLz2r");
    expect(h.startsWith("scrypt$")).toBe(true);
    expect(await conferirSenha("Bm#7kQ9pLz2r", h)).toBe(true);
    expect(await conferirSenha("Bm#7kQ9pLz2R", h)).toBe(false);
    expect(await conferirSenha("Bm#7kQ9pLz2r", null)).toBe(false);
  });
});

describe("authenticator (TOTP, RFC 6238)", () => {
  // Segredo do apêndice B da RFC 6238 ("12345678901234567890"), 6 últimos dígitos.
  const RFC = base32(Buffer.from("12345678901234567890"));

  it("bate com os vetores de teste da RFC", () => {
    expect(RFC).toBe("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
    expect(codigo(RFC, Math.floor(59 / 30))).toBe("287082");
    expect(codigo(RFC, Math.floor(1111111109 / 30))).toBe("081804");
    expect(codigo(RFC, Math.floor(1234567890 / 30))).toBe("005924");
    expect(codigo(RFC, Math.floor(2000000000 / 30))).toBe("279037");
  });

  it("base32 vai e volta", () => {
    const s = gerarSegredo();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32(deBase32(s))).toBe(s);
  });

  it("aceita o código atual e os vizinhos (±30 s), e recusa o resto", () => {
    const agora = 1_700_000_000_000;
    const p = passoAtual(agora);
    expect(conferirCodigo(RFC, codigo(RFC, p), -1, agora)).toBe(p);
    expect(conferirCodigo(RFC, codigo(RFC, p - 1), -1, agora)).toBe(p - 1);
    expect(conferirCodigo(RFC, codigo(RFC, p + 1), -1, agora)).toBe(p + 1);
    expect(conferirCodigo(RFC, codigo(RFC, p - 2), -1, agora)).toBeNull();
    expect(conferirCodigo(RFC, "12345", -1, agora)).toBeNull();
    expect(conferirCodigo(RFC, "abcdef", -1, agora)).toBeNull();
  });

  it("não aceita o mesmo código duas vezes", () => {
    const agora = 1_700_000_000_000;
    const p = passoAtual(agora);
    const c = codigo(RFC, p);
    expect(conferirCodigo(RFC, c, p, agora)).toBeNull();
    expect(conferirCodigo(RFC, codigo(RFC, p - 1), p, agora)).toBeNull();
  });

  it("monta o endereço do QR code", () => {
    const u = uriOtpauth("JBSWY3DPEHPK3PXP", "ana@denvercontabil.com.br");
    expect(u.startsWith("otpauth://totp/Lastro%20Bate%20PDF%3Aana%40denvercontabil.com.br?")).toBe(true);
    expect(u).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(u).toContain("issuer=Lastro+Bate+PDF");
  });
});

describe("contas e convites", () => {
  const base = (): Usuario => ({
    email: "ana@denvercontabil.com.br",
    nome: "Ana",
    perfil: "usuario",
    ativo: true,
    senha: null,
    totp: null,
    ultimoPasso: -1,
    convite: null,
    sessoes: [],
    criadoEm: 0,
    criadoPor: "admin@denvercontabil.com.br",
    ultimoAcesso: null,
  });

  it("acha a conta pelo token do convite enquanto ele vale, e guarda só o hash", () => {
    const agora = Date.now();
    const { token, convite } = novoConvite("cadastro", "admin", agora);
    const u = { ...base(), convite };
    expect(convite.hash).toBe(hashToken(token));
    expect(JSON.stringify(u)).not.toContain(token);
    expect(acharPorConvite([u], token, agora)?.email).toBe(u.email);
    expect(acharPorConvite([u], token, agora + 49 * 3_600_000)).toBeNull();
    expect(acharPorConvite([u], token + "x", agora)).toBeNull();
    expect(acharPorConvite([{ ...u, ativo: false }], token, agora)).toBeNull();
  });

  it("situação: convite, ativo, redefinição pendente e desativado", () => {
    const agora = Date.now();
    const { convite } = novoConvite("cadastro", "admin", agora);
    expect(situacao({ ...base(), convite }, agora)).toBe("convite");
    expect(situacao({ ...base(), convite }, agora + 49 * 3_600_000)).toBe("convite_vencido");
    const ativo = { ...base(), senha: "h", totp: "t" };
    expect(situacao(ativo, agora)).toBe("ativo");
    expect(situacao({ ...ativo, convite: novoConvite("redefinir", "admin", agora).convite }, agora)).toBe("ativo");
    expect(situacao({ ...ativo, ativo: false }, agora)).toBe("desativado");
  });

  it("guarda no máximo 10 sessões e descarta as vencidas", () => {
    const agora = Date.now();
    const u = base();
    u.sessoes = [{ id: "velha", criada: 0, visto: agora - 31 * 86_400_000 }];
    for (let i = 0; i < 12; i++) abrirSessaoNaConta(u, "teste", agora + i);
    expect(u.sessoes).toHaveLength(10);
    expect(u.sessoes.some((s) => s.id === "velha")).toBe(false);
    expect(u.ultimoAcesso).toBe(agora + 11);
  });
});

describe("para onde voltar depois do login", () => {
  const O = "https://lastro.vercel.app";
  it("aceita caminhos do painel, com a busca", () => {
    expect(caminhoSeguro("/relatorios?tri=2026-3", O)).toBe("/relatorios?tri=2026-3");
    expect(caminhoSeguro("/fundos", O)).toBe("/fundos");
  });
  it("recusa outros sites, inclusive os disfarçados", () => {
    for (const v of ["//evil.example", "/\\evil.example", "/\tevil", "/\t/evil.example", "https://evil.example", "/%5Cevil.example", "javascript:alert(1)", "", null]) {
      const r = caminhoSeguro(v, O);
      expect(r === "/" || new URL(r, O).origin === O).toBe(true);
    }
    expect(caminhoSeguro("/\\evil.example", O)).toBe("/");
    expect(caminhoSeguro("/\t/evil.example", O)).toBe("/");
  });
  it("não volta para a API nem para as telas de acesso", () => {
    expect(caminhoSeguro("/api/usuarios", O)).toBe("/");
    expect(caminhoSeguro("/entrar?voltar=/x", O)).toBe("/");
    expect(caminhoSeguro("/convite#t=abc", O)).toBe("/");
  });
});
