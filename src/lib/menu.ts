/**
 * As "pastas" do menu, iguais às do Bate Lastro (frontend/src/context/menuDoSistema.js e
 * components/SideBar/Sidebar.jsx): Home, Gestão ▸, Análise ▸, Bates e Perfil. As rotas são as
 * mesmas do Bate Lastro, para quem usa os dois sistemas achar tudo no mesmo lugar.
 *
 * `emBreve`: tela do Bate Lastro que ainda não foi trazida para cá (aparece apagada no menu).
 */

export type IconeMenu =
  | 'home' | 'gestao' | 'analise' | 'bates' | 'perfil'
  | 'base' | 'anexo' | 'fundos' | 'ia' | 'relatorios' | 'amostra' | 'blacklist'
  | 'dashboard' | 'visualizar' | 'lotes' | 'nf';

export type ItemMenu = { href: string; rotulo: string; icone: IconeMenu; emBreve?: boolean; dica?: string };
export type GrupoMenu = { id: 'gestao' | 'analise'; rotulo: string; icone: IconeMenu; itens: ItemMenu[] };
export type EntradaMenu = ItemMenu | GrupoMenu;

export const MENU: EntradaMenu[] = [
  { href: '/', rotulo: 'Home', icone: 'home' },
  {
    id: 'gestao',
    rotulo: 'Gestão',
    icone: 'gestao',
    itens: [
      { href: '/base', rotulo: 'Upload Base', icone: 'base' },
      { href: '/anexo', rotulo: 'Anexo', icone: 'anexo' },
      { href: '/cadastro-fundo', rotulo: 'Fundos', icone: 'fundos' },
      { href: '/treinamento-ia', rotulo: 'Treinar IA', icone: 'ia', emBreve: true },
      { href: '/relatorios', rotulo: 'Relatórios CVM/NIX', icone: 'relatorios', emBreve: true },
      { href: '/amostra', rotulo: 'Amostra', icone: 'amostra' },
      { href: '/blacklist', rotulo: 'BlackList', icone: 'blacklist' },
    ],
  },
  {
    id: 'analise',
    rotulo: 'Análise',
    icone: 'analise',
    itens: [
      { href: '/home', rotulo: 'Dashboard', icone: 'dashboard' },
      { href: '/visualizar', rotulo: 'Visualizar', icone: 'visualizar' },
      { href: '/lotes', rotulo: 'Lotes', icone: 'lotes' },
      { href: '/acompanhamento-nota-fiscal', rotulo: 'NF Status', icone: 'nf', emBreve: true },
    ],
  },
  { href: '/auditoria-selection', rotulo: 'Bates', icone: 'bates' },
];

export const PERFIL: ItemMenu = { href: '/perfil', rotulo: 'Perfil', icone: 'perfil' };

export const ehGrupo = (e: EntradaMenu): e is GrupoMenu => 'itens' in e;

/** Telas internas que pertencem a uma entrada do menu (para acender o item certo). */
const TELAS_DE: Record<string, (caminho: string) => boolean> = {
  // Bates › Gestão de Bates › Resultados, e o Bater PDF de cada base.
  '/auditoria-selection': (c) =>
    ['/auditoria-selection', '/pre-matches', '/results'].some((r) => c === r || c.startsWith(r + '/')) ||
    (c.startsWith('/bases/') && c !== '/bases/nova'),
  '/base': (c) => c === '/base' || c === '/bases/nova',
};

export function rotaAtiva(href: string, caminho: string): boolean {
  if (href === '/') return caminho === '/';
  const regra = TELAS_DE[href];
  return regra ? regra(caminho) : caminho === href || caminho.startsWith(href + '/');
}
