// Simulador de los dos servicios de terceros que el servidor consulta por
// internet, para el runner:
//
//  - api.coingecko.com: los precios de cripto. Desde las IPs compartidas de un
//    centro de datos ese servicio contesta 429 desde la primera llamada.
//  - api.hacienda.go.cr: el tipo de cambio oficial del dolar y del euro. Desde
//    que una base nueva ya no trae un tipo de cambio inventado (migracion 088),
//    cripto en colones no opera hasta que la fuente confirma uno; con el servicio
//    real, una respuesta 5xx a la primera consulta dejaba el recorrido sin tipo
//    de cambio durante una hora.
//
// Un recorrido que dependa de terceros que limitan o fallan a voluntad fallaria
// por razones ajenas al servidor. Aqui responden cifras fijas, con la misma forma
// que los servicios de verdad, a las unicas rutas que el servidor consulta. El
// servidor NO se modifica: el workflow apunta los dos nombres a esta maquina y le
// da a Go el certificado de este simulador (SSL_CERT_FILE).
//
// Uso: node terceros.mjs <puerto> <llave.pem> <certificado.pem>
import https from 'node:https';
import fs from 'node:fs';

const [, , puertoArg, llave, certificado] = process.argv;
const puerto = Number(puertoArg || 443);

// id de CoinGecko -> precio en USD. Los ids son los de backend/internal/crypto/prices.go.
const PRECIOS = {
  bitcoin: 60000,
  ethereum: 3000,
  solana: 150,
  cardano: 0.5,
  polkadot: 7,
  'avalanche-2': 35,
  chainlink: 15,
  'polygon-ecosystem-token': 0.5,
  uniswap: 8,
  cosmos: 8,
};

// Tipo de cambio del dolar en colones y del euro en dolares. El servidor cobra
// con la venta; la compra solo tiene que ser menor y quedar a menos de 10 % de ella.
const DOLAR_COMPRA = 445.5;
const DOLAR_VENTA = 451.25;
const DOLARES_POR_EURO = 1.16;

function mercado(id) {
  const precio = PRECIOS[id];
  const sparkline = Array.from({ length: 168 }, (_, i) => Number((precio * (1 + Math.sin(i / 12) * 0.01)).toFixed(6)));
  return {
    id,
    current_price: precio,
    market_cap: precio * 1_000_000,
    total_volume: precio * 50_000,
    high_24h: precio * 1.02,
    low_24h: precio * 0.98,
    price_change_percentage_24h: 1.25,
    last_updated: new Date().toISOString(),
    sparkline_in_7d: { price: sparkline },
  };
}

// La fecha del dia, como la publica la fuente oficial (AAAA-MM-DD).
const hoy = () => new Date().toISOString().slice(0, 10);

const servidor = https.createServer({ key: fs.readFileSync(llave), cert: fs.readFileSync(certificado) }, (req, res) => {
  const url = new URL(req.url, 'https://api.coingecko.com');
  res.setHeader('Content-Type', 'application/json');
  if (url.pathname === '/api/v3/ping') {
    res.end(JSON.stringify({ gecko_says: '(V3) To the Moon!' }));
    return;
  }
  if (url.pathname === '/api/v3/coins/markets') {
    const ids = (url.searchParams.get('ids') || '').split(',').filter((id) => id in PRECIOS);
    res.end(JSON.stringify(ids.map(mercado)));
    return;
  }
  if (url.pathname === '/indicadores/tc/dolar') {
    res.end(JSON.stringify({
      venta: { fecha: hoy(), valor: DOLAR_VENTA },
      compra: { fecha: hoy(), valor: DOLAR_COMPRA },
    }));
    return;
  }
  if (url.pathname === '/indicadores/tc/euro') {
    res.end(JSON.stringify({ fecha: hoy(), dolares: DOLARES_POR_EURO, colones: Number((DOLARES_POR_EURO * DOLAR_VENTA).toFixed(2)) }));
    return;
  }
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'ruta que el simulador no conoce' }));
});

servidor.listen(puerto, '127.0.0.1', () => {
  console.log(`Simulador de CoinGecko y de Hacienda escuchando en https://127.0.0.1:${puerto}`);
});
