// Orden de los flujos. Importa: el de comercio deja listo el negocio que usan el
// cobro con QR y el modo negocio, y el libro final va siempre al ultimo.
import preparacion from './01-preparacion.mjs';
import enviarDinero from './02-enviar-dinero.mjs';

export default [preparacion, enviarDinero];
