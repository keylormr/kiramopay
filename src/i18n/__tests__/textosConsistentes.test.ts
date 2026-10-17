import es from '../languages/es';
import en from '../languages/en';
import fr from '../languages/fr';
import pt from '../languages/pt';
import zh from '../languages/zh-cn';
import ja from '../languages/ja';
import hi from '../languages/hi';
import type { TranslationKeys } from '../translations';

// La app le habla de "tu" a la persona. Seis textos se habian escrito con
// voseo ("podés", "Vos enviás", "Escaneá", "Agregá... además de vos") y sonaban
// a otra app. `` no sirve con letras acentuadas, por eso los bordes a mano.
// La segunda parte es el imperativo con el pronombre pegado ("Pedile",
// "Ponele", "Revisalos", "imprimilo"): en voseo va sin tilde y en tuteo la
// lleva ("Pídele", "Revísalos", "imprímelo"). La lista vieja no lo veia y
// ocho textos lo conservaban.
const VOSEO = new RegExp(
  '(?<![a-záéíóúñ])(' +
    'vos|podés|tenés|querés|sabés|enviás|escaneá|revisá|agregá|tocá|elegí|escribí|mirá|probá|hacé|poné|decí|confirmá|' +
    'pedile|pedila|pedilo|ponele|ponelo|decile|decilo|mandale|mandalo|avisale|avisanos|escribile|escribinos|' +
    'contale|contanos|mostrale|mostralo|pasale|pasalo|revisalos?|revisalas?|imprimilos?|pegalos?|copialos?|' +
    'guardalos?|usalos?|fijate|acordate|asegurate|registrate' +
    ')(?![a-záéíóúñ])',
  'i',
);

describe('el espanol de la app tutea', () => {
  it('ningun texto usa voseo', () => {
    const conVoseo = Object.entries(es as unknown as Record<string, string>)
      .filter(([, texto]) => VOSEO.test(texto))
      .map(([clave]) => clave);
    expect(conVoseo).toEqual([]);
  });
});

// Los dos avisos de una operacion de cripto repetida mandan a revisar "tus
// movimientos", pero la lista de la pantalla de cripto se llama "Transacciones
// recientes": la persona busca algo que se llama distinto. Nombran la lista
// como la pantalla, en cada idioma.
describe('los avisos de cripto nombran la lista como la pantalla', () => {
  const idiomas: Array<[string, TranslationKeys]> = [
    ['es', es], ['en', en], ['fr', fr], ['pt', pt], ['zh-cn', zh], ['ja', ja], ['hi', hi],
  ];
  it.each(idiomas)('%s', (_idioma, d) => {
    const lista = d.recent_crypto_tx.toLowerCase();
    expect(d.crypto_already_done_hint.toLowerCase()).toContain(lista);
    expect(d.crypto_err_repeated_request.toLowerCase()).toContain(lista);
  });
});
