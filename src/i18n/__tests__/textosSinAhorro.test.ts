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
// invertir ni de hacer crecer el dinero. La decision del 2026-11-07 la extiende
// al resto de la app: todo pasa a "Metas" / "apartar dinero". Los nombres
// internos (claves savings_*, SavingsView) no cambian, solo los textos.

const CLAVES = [
  'banner_plans_body',
  'onboard_title_4',
  'onboard_desc_4',
  'home_savings',
  'home_savings_desc',
  'analytics_cat_savings',
  'tx_title_savings_deposit',
  'tx_title_savings_withdraw',
  'savings_title',
  'savings_total_saved',
  'savings_no_goals',
  'savings_no_goals_desc',
  'savings_err_load',
  'savings_withdraw_exceeds_saved',
  'savings_delete_returns',
  'help_savings_title',
  'help_savings_body',
  'plans_row_goals',
  'plans_same_3',
  'del_block_SAVINGS_BALANCE',
  'meta_icono_dinero',
] as const;

const PROHIBIDO: Record<string, RegExp> = {
  es: /ahorr|invier|invert|crecer/i,
  en: /sav(e|ing)|invest|grow/i, // las claves de la lista no llevan "save" en ningun sentido
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
    expect(es.analytics_cat_savings).toBe('Metas');
    expect(es.tx_title_savings_deposit).toBe('Aporte a meta');
    expect(es.tx_title_savings_withdraw).toBe('Retiro de meta');
    expect(es.savings_title).toBe('Metas');
    expect(es.savings_total_saved).toBe('Total apartado');
    expect(es.savings_no_goals).toBe('Sin metas todavía');
    expect(es.savings_err_load).toBe('No pudimos cargar tus metas.');
    expect(es.help_savings_title).toBe('Metas');
    expect(es.plans_row_goals).toBe('Metas activas');
    expect(es.del_block_SAVINGS_BALANCE).toBe('Tienes dinero en tus metas. Pásalo a tu billetera y deja las metas en cero.');
  });
});
