import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { loadLanguage } from './i18n/translations';
import { idiomaInicial } from './i18n/idiomaDeLaPersona';
import { armarIntroDeErgane } from './ergane/introDeErgane';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

// La intro de Ergane (solo en la web, una vez por navegador) se pone ANTES del
// primer pintado de la app, igual que el diccionario: si la app pintara primero,
// el login se veria un instante y luego quedaria tapado. La capa va por encima
// de todo, asi que la app arranca debajo sin esperar a que la intro termine.
// En Android e iOS no hace nada: esas apps ya tienen su intro de la K.
const introDeErgane = armarIntroDeErgane();

// El diccionario del idioma de la persona se pide ANTES de pintar: el espanol va
// en el paquete y los demas idiomas llegan en su propio trozo, asi que el primer
// pintado salia siempre en espanol (la pantalla de arranque, el login) y, si el
// trozo tardaba o fallaba, asi se quedaba. Con tope: una red que no contesta no
// puede dejar la pantalla en blanco; pasado el tope se pinta en espanol y el
// idioma entra cuando llegue.
const ESPERA_MAXIMA_MS = 2500;
const diccionario = Promise.race([
  loadLanguage(idiomaInicial()).catch(() => undefined),
  new Promise<void>((resolver) => setTimeout(resolver, ESPERA_MAXIMA_MS)),
]);

void Promise.all([diccionario, introDeErgane]).then(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
