// Orden de los flujos. Importa: el de comercio deja listo el negocio que usan el
// cobro con QR y el modo negocio, y el libro final va siempre al ultimo.
import preparacion from './01-preparacion.mjs';
import enviarDinero from './02-enviar-dinero.mjs';
import cripto from './03-cripto.mjs';
import comercioAlta from './04-comercio-alta.mjs';
import cobroQr from './05-cobro-qr.mjs';
import escrow from './06-escrow.mjs';
import dividirCuenta from './07-dividir-cuenta.mjs';
import retiro from './08-retiro.mjs';

export default [preparacion, enviarDinero, cripto, comercioAlta, cobroQr, escrow, dividirCuenta, retiro];
