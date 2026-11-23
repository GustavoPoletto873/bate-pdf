import type { Metadata } from 'next';
import { connection } from 'next/server';
import { Suspense } from 'react';
import { loginObrigatorio } from '@/lib/auth/config';
import { FormularioEntrar } from './FormularioEntrar';

export const metadata: Metadata = { title: 'Entrar · Lastro' };

/** Lê a configuração na hora do pedido (não no build): o login pode ser ligado só no servidor. */
async function Formulario() {
  await connection();
  return <FormularioEntrar loginLigado={loginObrigatorio()} />;
}

export default function PaginaEntrar() {
  return (
    <Suspense fallback={null}>
      <Formulario />
    </Suspense>
  );
}
