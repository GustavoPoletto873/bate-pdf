/** Onde a escolha de tema fica guardada neste computador ('claro' | 'escuro'). */
export const CHAVE_TEMA = 'lastro-tema';

/** Roda no <head> antes da primeira pintura: aplica o modo escuro guardado sem piscar branco. */
export const SCRIPT_TEMA = `try{if(localStorage.getItem('${CHAVE_TEMA}')==='escuro')document.documentElement.classList.add('dark')}catch(e){}`;
