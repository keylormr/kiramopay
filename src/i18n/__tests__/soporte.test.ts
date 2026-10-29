import es from '../languages/es';
import en from '../languages/en';
import fr from '../languages/fr';
import pt from '../languages/pt';
import zh from '../languages/zh-cn';
import ja from '../languages/ja';
import hi from '../languages/hi';

// Soporte. El chat en vivo no existe: la unica forma de escribirle a una
// persona del equipo es el correo soporte@kiramopay.com. Los textos de la app
// ya no prometen un chat que "llegara pronto" y toda frase que manda a "escribir
// a soporte" dice a donde, en los siete idiomas.
const CORREO = 'soporte@kiramopay.com';

const idiomas: Array<[string, Record<string, string>]> = [
  ['es', es as unknown as Record<string, string>],
  ['en', en as unknown as Record<string, string>],
  ['fr', fr as unknown as Record<string, string>],
  ['pt', pt as unknown as Record<string, string>],
  ['zh-cn', zh as unknown as Record<string, string>],
  ['ja', ja as unknown as Record<string, string>],
  ['hi', hi as unknown as Record<string, string>],
];

// Frases que mandan a la persona a escribir a soporte.
const CLAVES_CON_CORREO = [
  'faq_a9',
  'account_blocked_body',
  'login_account_blocked',
  'del_block_unknown',
  'del_err_generic',
  'admin_resp_rejected',
] as const;

describe.each(idiomas)('soporte (%s)', (_idioma, d) => {
  it.each(CLAVES_CON_CORREO)('%s dice a donde escribir', (clave) => {
    expect(d[clave]).toContain(CORREO);
  });

  it('el rotulo de soporte ya no promete un chat', () => {
    expect(d.support_write_title?.trim()).toBeTruthy();
    expect(d.support_write_desc?.trim()).toBeTruthy();
    expect('chat_support' in d).toBe(false);
    expect('support_soon_desc' in d).toBe(false);
  });

  it('ningun texto de soporte promete que el chat llegara', () => {
    const texto = `${d.support_write_title} ${d.support_write_desc} ${d.faq_a9}`.toLowerCase();
    expect(texto).not.toMatch(/pronto|próximamente|coming soon|bientôt|bientot|em breve|近日|即将|जल्द/);
  });
});
