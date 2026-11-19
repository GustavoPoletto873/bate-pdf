/**
 * Leitor de XML mínimo para a NF-e (sem dependência nova): elementos, atributos, texto,
 * CDATA e comentários. DTD/entidades são recusados, como no Bate Lastro
 * ("XML com DTD/entidades não é permitido"). Nomes guardados sem o prefixo de namespace.
 */

export type NoXml = { nome: string; atributos: Record<string, string>; filhos: NoXml[]; texto: string };

export class XmlInvalido extends Error {}

const ENTIDADES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodificar(t: string): string {
  return t.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e.startsWith('#x')) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith('#')) return String.fromCodePoint(Number(e.slice(1)));
    return ENTIDADES[e] ?? m;
  });
}

const semPrefixo = (n: string) => n.slice(n.indexOf(':') + 1);

export function lerXml(conteudo: string): NoXml {
  const xml = conteudo.replace(/^﻿/, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new XmlInvalido('XML com DTD/entidades não é permitido');
  const raiz: NoXml = { nome: '#documento', atributos: {}, filhos: [], texto: '' };
  const pilha: NoXml[] = [raiz];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      pilha[pilha.length - 1].texto += decodificar(xml.slice(i));
      break;
    }
    if (lt > i) pilha[pilha.length - 1].texto += decodificar(xml.slice(i, lt));
    if (xml.startsWith('<?', lt)) {
      const fim = xml.indexOf('?>', lt);
      if (fim < 0) throw new XmlInvalido('XML inválido: instrução sem fim');
      i = fim + 2;
    } else if (xml.startsWith('<!--', lt)) {
      const fim = xml.indexOf('-->', lt);
      if (fim < 0) throw new XmlInvalido('XML inválido: comentário sem fim');
      i = fim + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const fim = xml.indexOf(']]>', lt);
      if (fim < 0) throw new XmlInvalido('XML inválido: CDATA sem fim');
      pilha[pilha.length - 1].texto += xml.slice(lt + 9, fim);
      i = fim + 3;
    } else if (xml.startsWith('</', lt)) {
      const fim = xml.indexOf('>', lt);
      if (fim < 0) throw new XmlInvalido('XML inválido: tag sem fim');
      const nome = semPrefixo(xml.slice(lt + 2, fim).trim());
      const topo = pilha.pop();
      if (!topo || topo.nome !== nome || pilha.length === 0) throw new XmlInvalido(`XML inválido: </${nome}> sem abertura`);
      i = fim + 1;
    } else {
      const fim = xml.indexOf('>', lt);
      if (fim < 0) throw new XmlInvalido('XML inválido: tag sem fim');
      let corpo = xml.slice(lt + 1, fim);
      const fechada = corpo.endsWith('/');
      if (fechada) corpo = corpo.slice(0, -1);
      const m = /^\s*([^\s/>]+)/.exec(corpo);
      if (!m) throw new XmlInvalido('XML inválido: tag sem nome');
      const no: NoXml = { nome: semPrefixo(m[1]), atributos: {}, filhos: [], texto: '' };
      const reAttr = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      const resto = corpo.slice(m[0].length);
      while ((a = reAttr.exec(resto))) no.atributos[semPrefixo(a[1])] = decodificar(a[3] ?? a[4] ?? '');
      pilha[pilha.length - 1].filhos.push(no);
      if (!fechada) pilha.push(no);
      i = fim + 1;
    }
  }
  if (pilha.length !== 1) throw new XmlInvalido('XML inválido: elementos sem fechamento');
  if (!raiz.filhos.length) throw new XmlInvalido('XML inválido: sem elemento raiz');
  return raiz.filhos[0];
}

/** Primeiro descendente (busca em profundidade, em ordem) com esse nome — o `.//tag`. */
export function acharDescendente(no: NoXml, nome: string): NoXml | null {
  for (const f of no.filhos) {
    if (f.nome === nome) return f;
    const r = acharDescendente(f, nome);
    if (r) return r;
  }
  return null;
}

/** Todos os descendentes com esse nome (`findall('.//tag')`). */
export function todosDescendentes(no: NoXml, nome: string, saida: NoXml[] = []): NoXml[] {
  for (const f of no.filhos) {
    if (f.nome === nome) saida.push(f);
    todosDescendentes(f, nome, saida);
  }
  return saida;
}

/** Filho direto com esse nome. */
export const acharFilho = (no: NoXml, nome: string) => no.filhos.find((f) => f.nome === nome) ?? null;

/** O próprio nó ou algum descendente tem esse nome? */
export function contem(no: NoXml, nome: string): boolean {
  return no.nome === nome || acharDescendente(no, nome) !== null;
}
