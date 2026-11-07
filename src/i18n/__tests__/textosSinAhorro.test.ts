import es from '../languages/es';
import en from '../languages/en';
import fr from '../languages/fr';
import pt from '../languages/pt';
import zhCn from '../languages/zh-cn';
import ja from '../languages/ja';
import hi from '../languages/hi';

// Decision del dueno (2026-11-06): "Ahorros" es el mayor riesgo regulatorio del
// proyecto (captacion de recursos del publico), asi que el carrusel de planes,
// la bienvenida 4 y el acceso a Metas del Inicio no hablan de ahorro, ni de
// invertir ni de hacer crecer el dinero. El resto de la app no se decidio aun.

const CLAVES = ['banner_plans_body', 'onboard_title_4', 'onboard_desc_4', 'home_savings', 'home_savings_desc'] as const;

const PROHIBIDO: Record<string, RegExp> = {
  es: /ahorr|invier|invert|crecer/i,
  en: /sav(e|ing)|invest|grow/i,
  fr: /épargn|invest|fructifi/i,
  pt: /econom|invest|render/i,
  'zh-cn': /储蓄|投资|增长/,
  ja: /貯蓄|貯金|投資|増や/,
  hi: /बचत|निवेश|बढ़ा/,
};

const IDIOMAS = { es, en, fr, pt, 'zh-cn': zhCn, ja, hi };

describe('textos sin "ahorro" (decision del dueno)', () => {
  for (const [idioma, dic] of Object.entries(IDIOMAS)) {
    it.each(CLAVES)(`${idioma}: %s`, (clave) => {
      expect(dic[clave]).not.toMatch(PROHIBIDO[idioma]);
    });
  }

  it('en espanol quedan como los aprobo el dueno', () => {
    expect(es.banner_plans_body).toBe('Plus y Pro llegan muy pronto: más consultas al asistente, más metas y más tarjetas.');
    expect(es.onboard_title_4).toBe('Organiza tu dinero');
    expect(es.home_savings).toBe('Metas');
    expect(es.home_savings_desc).toBe('Aparta dinero para lo que quieres');
  });
});
