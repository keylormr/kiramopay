// Simulador del proveedor de precios de cripto (CoinGecko) para el runner.
//
// Por que existe: el servidor pide los precios a api.coingecko.com, y desde las
// IPs compartidas de un centro de datos ese servicio contesta 429 desde la
// primera llamada. Un recorrido que dependa de un tercero que limita a
// voluntad fallaria por razones ajenas al servidor. Aqui responde precios
// fijos, con la misma forma que /coins/markets, a la unica ruta que el
// servidor consulta. El servidor NO se modifica: el workflow apunta el nombre
// api.coingecko.com a esta maquina y le da a Go el certificado de este
// simulador (SSL_CERT_FILE).
//
// Uso: node coingecko.mjs <puerto> <llave.pem> <certificado.pem>
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
  res.statusCode = 404;
  res.end(JSON.stringify({ error: 'ruta que el simulador no conoce' }));
});

servidor.listen(puerto, '127.0.0.1', () => {
  console.log(`Simulador de CoinGecko escuchando en https://127.0.0.1:${puerto}`);
});
