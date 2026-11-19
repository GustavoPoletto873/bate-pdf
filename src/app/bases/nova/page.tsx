import { redirect } from 'next/navigation';

// A antiga "Nova base" virou o Upload Base (Gestão › Upload Base); os PDFs sobem pelo Anexo.
export default function NovaBase() {
  redirect('/base');
}
