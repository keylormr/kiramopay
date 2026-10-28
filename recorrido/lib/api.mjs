// Cliente de la API para las comprobaciones del recorrido. Cada `entrar` abre
// una sesion NUEVA con el login sin contrasena (no cierra la del navegador) y
// guarda su token de acceso en memoria. Es el token "vivo" que exigen las rutas
// de administrador: no se refresca nunca, asi que no lo rota nadie.
import { API } from './entorno.mjs';
import { anotar, cupo, pausa } from './regulador.mjs';

/** Respuesta de la API ya interpretada. */
export class Respuesta {
  constructor(status, cuerpo, texto) {
    this.status = status;
    this.ok = status >= 200 && status < 300;
    this.cuerpo = cuerpo; // JSON completo (o null)
    this.texto = texto;
  }
  /** `data` del sobre {success, data}; si no hay sobre, el cuerpo tal cual. */
  get data() {
    if (this.cuerpo && typeof this.cuerpo === 'object' && 'success' in this.cuerpo) return this.cuerpo.data;
    return this.cuerpo;
  }
  get codigo() {
    return this.cuerpo?.error?.code ?? null;
  }
  get mensaje() {
    return this.cuerpo?.error?.message ?? this.texto?.slice(0, 200) ?? '';
  }
  /** Descripcion corta para mensajes de fallo. */
  resumen() {
    return this.ok ? `HTTP ${this.status}` : `HTTP ${this.status} ${this.codigo ?? ''} ${this.mensaje}`.trim();
  }
}

export async function peticion(metodo, ruta, { token, cuerpo, cabeceras } = {}) {
  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: {
      ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(cabeceras ?? {}),
    },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = null;
  }
  return new Respuesta(res.status, json, texto);
}

export class Cliente {
  constructor(usuario, token, perfil) {
    this.usuario = usuario;
    this.token = token;
    this.perfil = perfil; // data.user del login
  }
  get id() {
    return this.perfil?.id;
  }
  /**
   * Una peticion con el ritmo regulado: espera si la persona ya va muy rapido y,
   * si el servidor aun asi contesta 429, espera y repite (es el limite por minuto,
   * no un resultado de lo que se prueba).
   */
  async pedir(metodo, ruta, cuerpo, cabeceras) {
    let r;
    for (let intento = 0; intento < 4; intento++) {
      await cupo(this.usuario);
      anotar(this.usuario);
      r = await peticion(metodo, ruta, { token: this.token, cuerpo, cabeceras });
      if (r.status !== 429) return r;
      await pausa(10_000);
    }
    return r;
  }
  get(ruta, cabeceras) {
    return this.pedir('GET', ruta, undefined, cabeceras);
  }
  post(ruta, cuerpo = {}, cabeceras) {
    return this.pedir('POST', ruta, cuerpo, cabeceras);
  }
  put(ruta, cuerpo = {}, cabeceras) {
    return this.pedir('PUT', ruta, cuerpo, cabeceras);
  }
  patch(ruta, cuerpo = {}, cabeceras) {
    return this.pedir('PATCH', ruta, cuerpo, cabeceras);
  }
  delete(ruta, cabeceras) {
    return this.pedir('DELETE', ruta, undefined, cabeceras);
  }

  /** Igual que get/post, pero lanza si la respuesta no es 2xx. */
  async exigir(metodo, ruta, cuerpo, cabeceras) {
    const r = await this.pedir(metodo, ruta, cuerpo, cabeceras);
    if (!r.ok) throw new Error(`${metodo} ${ruta} (${this.usuario}): ${r.resumen()}`);
    return r;
  }

  /** Saldos de la billetera en unidades menores: {crc, usd}. */
  async saldo() {
    const r = await this.exigir('GET', '/wallets/me/balance');
    return { crc: r.data.crc, usd: r.data.usd };
  }

  /** Billetera completa (topes incluidos). */
  async billetera() {
    return (await this.exigir('GET', '/wallets/me')).data;
  }

  /** Movimientos del libro de la persona (mas nuevos primero). */
  async movimientos(filtros = {}) {
    const q = new URLSearchParams({ limit: '50', ...filtros }).toString();
    return (await this.exigir('GET', `/transactions?${q}`)).data.transactions ?? [];
  }
}

/** Login sin contrasena. Lanza si el servidor no abre la sesion. */
export async function entrar(usuario) {
  await cupo(usuario, 3);
  anotar(usuario);
  const r = await peticion('POST', '/auth/login', { cuerpo: { identifier: usuario, password: '' } });
  if (!r.ok || !r.data?.tokens?.access_token) {
    throw new Error(`No se pudo entrar como ${usuario} sin contraseña: ${r.resumen()}`);
  }
  return new Cliente(usuario, r.data.tokens.access_token, r.data.user);
}

/** Login con contrasena (solo para admin.kp, que no es cuenta de demostracion). */
export async function entrarConContrasena(identificador, password) {
  await cupo(identificador, 3);
  anotar(identificador);
  const r = await peticion('POST', '/auth/login', { cuerpo: { identifier: identificador, password } });
  if (!r.ok || !r.data?.tokens?.access_token) {
    throw new Error(`No se pudo entrar como ${identificador}: ${r.resumen()}`);
  }
  return new Cliente(identificador, r.data.tokens.access_token, r.data.user);
}

/** Espera a que `fn` devuelva algo verdadero (sondeo corto, para lo asincrono del servidor). */
export async function esperarHasta(fn, { intentos = 20, cadaMs = 500, descripcion = 'la condicion' } = {}) {
  let ultimo;
  for (let i = 0; i < intentos; i++) {
    ultimo = await fn();
    if (ultimo) return ultimo;
    await new Promise((r) => setTimeout(r, cadaMs));
  }
  throw new Error(`Se agotó la espera de ${descripcion}`);
}
