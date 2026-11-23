import type { Metadata } from 'next';
import { Suspense } from 'react';
import { FormularioConvite } from './FormularioConvite';

export const metadata: Metadata = { title: 'Criar acesso · Lastro', robots: { index: false } };

export default function PaginaConvite() {
  return (
    <Suspense fallback={null}>
      <FormularioConvite />
    </Suspense>
  );
}
