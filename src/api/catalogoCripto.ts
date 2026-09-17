import type { CryptoAsset } from '@/types';

// Catalogo de los activos que el backend soporta (el mismo listado que
// coinGeckoIDs en Go). Existe porque /crypto/assets devuelve las TENENCIAS del
// usuario: para una cuenta nueva eso es una lista vacia, y si el catalogo de
// compra se alimenta solo de ahi, quien no tiene cripto no puede comprar
// cripto — el modulo entero queda mudo. El catalogo pone el piso: todas las
// monedas soportadas, con saldo cero, y las tenencias reales se montan encima.
const MONEDAS: ReadonlyArray<Pick<CryptoAsset, 'id' | 'symbol' | 'name' | 'icon' | 'color'>> = [
  { id: 'btc', symbol: 'BTC', name: 'Bitcoin', icon: '₿', color: '#F7931A' },
  { id: 'eth', symbol: 'ETH', name: 'Ethereum', icon: 'Ξ', color: '#627EEA' },
  { id: 'sol', symbol: 'SOL', name: 'Solana', icon: '◎', color: '#9945FF' },
  { id: 'ada', symbol: 'ADA', name: 'Cardano', icon: '₳', color: '#0D1E30' },
  { id: 'dot', symbol: 'DOT', name: 'Polkadot', icon: '●', color: '#E6007A' },
  { id: 'avax', symbol: 'AVAX', name: 'Avalanche', icon: '▲', color: '#E84142' },
  { id: 'link', symbol: 'LINK', name: 'Chainlink', icon: '⬢', color: '#2A5ADA' },
  { id: 'matic', symbol: 'MATIC', name: 'Polygon', icon: '⬡', color: '#8247E5' },
  { id: 'uni', symbol: 'UNI', name: 'Uniswap', icon: '◈', color: '#FF007A' },
  { id: 'atom', symbol: 'ATOM', name: 'Cosmos', icon: '◉', color: '#2E3148' },
];

// La cara de monedas que no se compran en la aplicacion pero que una cuenta
// puede tener: las estables de una posicion de staking vieja, que al retirarse
// vuelven al saldo. Sin esto el circulo mostraba el simbolo en minusculas.
const CARAS_FUERA_DEL_CATALOGO: Readonly<Record<string, Pick<CryptoAsset, 'icon' | 'color' | 'name'>>> = {
  USDT: { name: 'Tether', icon: '₮', color: '#26A17B' },
  USDC: { name: 'USD Coin', icon: '$', color: '#2775CA' },
};

/** El catalogo completo con saldo cero; los precios los rellena el feed. */
export function catalogoCripto(): CryptoAsset[] {
  return MONEDAS.map((m) => ({
    ...m,
    balance: 0,
    avgBuyPrice: 0,
    currentPrice: 0,
    priceChange24h: 0,
    priceHistory: [],
  }));
}

/**
 * Monta las tenencias reales del backend sobre el catalogo. Una tenencia de
 * un simbolo del catalogo lo reemplaza; una de un simbolo desconocido se
 * conserva al final (nunca esconder saldo del usuario).
 */
export function fusionarConCatalogo(tenencias: CryptoAsset[]): CryptoAsset[] {
  const porSimbolo = new Map(tenencias.map((t) => [t.symbol, t]));
  // De la tenencia sale el saldo; la cara (icono, color, nombre) es la del
  // catalogo. El adaptador HTTP no conoce los iconos y ponia el simbolo en
  // minusculas ("btc") dentro del circulo.
  const base = catalogoCripto().map((c) => {
    const t = porSimbolo.get(c.symbol);
    return t ? { ...t, icon: c.icon, color: c.color, name: c.name } : c;
  });
  const conocidos = new Set(base.map((b) => b.symbol));
  const extras = tenencias
    .filter((t) => !conocidos.has(t.symbol))
    .map((t) => (CARAS_FUERA_DEL_CATALOGO[t.symbol] ? { ...t, ...CARAS_FUERA_DEL_CATALOGO[t.symbol] } : t));
  return [...base, ...extras];
}
