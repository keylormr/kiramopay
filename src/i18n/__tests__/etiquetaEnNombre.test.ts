import es from '../languages/es';
import en from '../languages/en';
import fr from '../languages/fr';
import pt from '../languages/pt';
import zhCn from '../languages/zh-cn';
import ja from '../languages/ja';
import hi from '../languages/hi';

// Las acciones cortas de la tarjeta de saldo ("Escanear", "Cobrar") llevan un
// nombre accesible mas largo ("Escanear QR", "Cobrar con QR"). Para quien usa
// control por voz, el nombre tiene que contener lo que se ve (WCAG 2.5.3):
// decir "Cobrar" tiene que encontrar el boton, en todos los idiomas.

const PARES = [
  ['accion_escanear', 'scan_qr'],
  ['accion_cobrar', 'charge_qr'],
] as const;

const IDIOMAS = { es, en, fr, pt, 'zh-cn': zhCn, ja, hi };

describe('etiqueta visible dentro del nombre accesible', () => {
  for (const [idioma, dic] of Object.entries(IDIOMAS)) {
    it.each(PARES)(`${idioma}: %s dentro de %s`, (visible, nombre) => {
      expect(dic[nombre].toLocaleLowerCase()).toContain(dic[visible].toLocaleLowerCase());
    });
  }
});
