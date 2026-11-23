import { beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Banco num diretório temporário; contas fictícias.
process.env.BATE_PDF_DADOS = mkdtempSync(join(tmpdir(), 'bate-pdf-contas-'));
let usuarios: typeof import('./usuarios');
let req: typeof import('./requisicao');

beforeAll(async () => {
  usuarios = await import('./usuarios');
  req = await import('./requisicao');
});

describe('contas no banco do app', () => {
  test('grava, lê, abre sessão, desativa e exclui', async () => {
    const agora = Date.now();
    const sid = await usuarios.alterarUsuarios((lista) => {
      const u: import('./usuarios').Usuario = {
        email: 'ana@denvercontabil.com.br', nome: 'Ana Teste', perfil: 'admin', ativo: true,
        senha: 'scrypt$hash', totp: 'cifrado', ultimoPasso: -1, convite: null, sessoes: [],
        criadoEm: agora, criadoPor: 'instalação', ultimoAcesso: null,
      };
      lista.push(u);
      return usuarios.abrirSessaoNaConta(u, 'teste', agora);
    });

    expect((await usuarios.lerUsuarios()).map((u) => u.email)).toEqual(['ana@denvercontabil.com.br']);
    const s = { v: 2 as const, email: 'ana@denvercontabil.com.br', sid, visto: agora };
    expect(await req.sessaoValida(s)).toEqual({ email: 'ana@denvercontabil.com.br', nome: 'Ana Teste', perfil: 'admin' });
    expect(await req.sessaoValida({ ...s, sid: 'outra' })).toBeNull();

    // Desativar derruba a sessão na hora (o cache se limpa a cada mudança nas contas).
    await usuarios.alterarUsuarios((lista) => {
      lista[0].ativo = false;
      lista[0].sessoes = [];
    });
    expect(await req.sessaoValida(s)).toBeNull();

    // Erro dentro da alteração desfaz tudo.
    await expect(usuarios.alterarUsuarios((lista) => {
      lista[0].nome = 'Mudou';
      throw new usuarios.ErroContas('não');
    })).rejects.toThrow('não');
    expect((await usuarios.buscarUsuario('ANA@denvercontabil.com.br'))?.nome).toBe('Ana Teste');

    await usuarios.alterarUsuarios((lista) => {
      lista.splice(0, 1);
    });
    expect(await usuarios.lerUsuarios()).toEqual([]);
  });

  test('limite de tentativas', async () => {
    const regra = [{ chave: 'teste:ip:1', maximo: 3, janelaS: 60 }];
    for (let i = 0; i < 3; i++) expect(await req.limitar(regra)).toBeNull();
    const r = await req.limitar(regra);
    expect(r?.status).toBe(429);
    expect(r?.headers.get('Retry-After')).toBe('60');

    expect(await req.bloqueado('teste:falhas', 2, 900)).toBeNull();
    await req.registrarFalha('teste:falhas');
    await req.registrarFalha('teste:falhas');
    expect((await req.bloqueado('teste:falhas', 2, 900))?.status).toBe(429);
  });
});
