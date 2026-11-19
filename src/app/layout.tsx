import type { Metadata } from 'next';
import { MenuLateral } from '@/components/MenuLateral';
import { SCRIPT_TEMA } from '@/lib/tema';
import './globals.css';

export const metadata: Metadata = {
  title: 'Lastro',
  description: 'Lastro: a versão local do Bate Lastro (Bater PDF, pré-classificação, bates e resultados), para quando o Bate Lastro estiver fora do ar',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    // suppressHydrationWarning: o script abaixo pode pôr .dark no <html> antes do React hidratar.
    <html lang="pt-BR" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_TEMA }} />
      </head>
      {/* pl-[88px]: espaço do menu lateral fixo (MenuLateral). */}
      <body className="flex h-full flex-col bg-white pl-[88px] text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <MenuLateral />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  );
}
