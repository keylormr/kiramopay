import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import App from './App';
import { loadLanguage } from './i18n/translations';
import { idiomaInicial } from './i18n/idiomaDeLaPersona';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);

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

void diccionario.then(() => {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
