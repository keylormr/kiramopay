// Orden de los flujos. Importa: el de comercio deja listo el negocio que usan el
// cobro con QR, el modo negocio y la pasada de telefono; el de recompensas
// fondea el fondo de promociones antes de que lo lea el panel de administracion;
// y el libro final va siempre al ultimo.
import preparacion from './01-preparacion.mjs';
import enviarDinero from './02-enviar-dinero.mjs';
import cripto from './03-cripto.mjs';
import comercioAlta from './04-comercio-alta.mjs';
import cobroQr from './05-cobro-qr.mjs';
import escrow from './06-escrow.mjs';
import dividirCuenta from './07-dividir-cuenta.mjs';
import retiro from './08-retiro.mjs';
import recibosRecargas from './09-recibos-recargas.mjs';
import pagosFijos from './10-pagos-fijos.mjs';
import presupuesto from './11-presupuesto.mjs';
import metasAhorro from './12-metas-ahorro.mjs';
import recompensas from './13-recompensas.mjs';
import modoNegocio from './14-modo-negocio.mjs';
import administracion from './15-administracion.mjs';
import telefono from './16-telefono.mjs';
import libroFinal from './17-libro-final.mjs';

export default [
  preparacion,
  enviarDinero,
  cripto,
  comercioAlta,
  cobroQr,
  escrow,
  dividirCuenta,
  retiro,
  recibosRecargas,
  pagosFijos,
  presupuesto,
  metasAhorro,
  recompensas,
  modoNegocio,
  administracion,
  telefono,
  libroFinal,
];
