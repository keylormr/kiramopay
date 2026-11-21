import es from '../languages/es';
import en from '../languages/en';
import fr from '../languages/fr';
import pt from '../languages/pt';
import zhCn from '../languages/zh-cn';
import ja from '../languages/ja';
import hi from '../languages/hi';

// La segunda pantalla de bienvenida prometia "SINPE Movil, QR, servicios y
// recargas". En produccion los recibos y las recargas se rechazan (no hay
// convenio con las empresas ni con los operadores) y el envio por numero de
// telefono solo llega a otra cuenta de KiramoPay: KiramoPay no esta conectada
// a SINPE. La bienvenida dice solo lo que hoy funciona.

const PROHIBIDO: Record<string, RegExp> = {
  es: /SINPE|servicio|recarga/i,
  en: /SINPE|service|top-?up/i,
  fr: /SINPE|service|recharge/i,
  pt: /SINPE|servi[cç]o|recarga/i,
  'zh-cn': /SINPE|服务|充值/,
  ja: /SINPE|サービス|チャージ/,
  hi: /SINPE|सेवा|रिचार्ज/,
};

const IDIOMAS = { es, en, fr, pt, 'zh-cn': zhCn, ja, hi };

describe('bienvenida sin promesas que produccion no cumple', () => {
  for (const [idioma, dic] of Object.entries(IDIOMAS)) {
    it(`${idioma}: onboard_desc_2 no promete SINPE, recibos ni recargas`, () => {
      expect(dic.onboard_desc_2).not.toMatch(PROHIBIDO[idioma]);
    });

    it(`${idioma}: onboard_desc_2 dice que el envio es a KiramoPay`, () => {
      expect(dic.onboard_desc_2).toContain('KiramoPay');
    });
  }
});
