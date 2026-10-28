// Direcciones y carpetas del recorrido. Todo sale de variables de entorno con un
// valor por defecto que sirve en el runner (backend en el 8080, pantalla en el
// 9999). Se usa SIEMPRE `localhost` y no 127.0.0.1: la politica CORS del
// servidor solo admite `http://localhost:*` y la cookie de sesion es
// SameSite=Strict.
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const API_BASE = process.env.RECORRIDO_API_URL || 'http://localhost:8080';
export const API = `${API_BASE}/api/v1`;
export const APP = process.env.RECORRIDO_APP_URL || 'http://localhost:9999';

// Carpeta de salida: capturas de escritorio, capturas de telefono, diagnosticos
// de los pasos que fallaron e informe en JSON y Markdown.
export const SALIDA = path.resolve(process.env.RECORRIDO_SALIDA || 'recorrido-salida');

// Marca unica de esta corrida. Va en los nombres y en las llaves de
// idempotencia: el libro tiene una llave UNICA GLOBAL, y una corrida que
// repitiera la de la anterior no movería dinero sin que nada lo avisara.
export const CORRIDA = randomUUID().slice(0, 8);

/** Llave de idempotencia nueva (maximo 100 caracteres). */
export function llave(prefijo) {
  return `rec-${CORRIDA}-${prefijo}-${randomUUID().slice(0, 8)}`;
}

// Cuentas de la semilla (backend/internal/database/seeder.go). Los tres
// nombres de usuario entran sin contrasena mientras el servidor tenga
// DEMO_LOGIN_ENABLED encendida.
export const CUENTAS = {
  keilor: { id: 'a0000000-0000-0000-0000-000000000001', telefono: '88880001', nombre: 'Keilor Martinez', crc: 125750000, usd: 34500 },
  victor: { id: 'a0000000-0000-0000-0000-000000000004', telefono: '88880004', nombre: 'Victor Lobo', crc: 250000000, usd: 50000 },
  emmanuel: { id: 'a0000000-0000-0000-0000-000000000005', telefono: '88880005', nombre: 'Emmanuel Coto', crc: 250000000, usd: 50000 },
  demo: { id: 'a0000000-0000-0000-0000-000000000003', telefono: '88880003', nombre: 'Demo KiramoPay', crc: 75000000, usd: 20000 },
};

/** Solo corre los flujos pedidos: RECORRIDO_SOLO="cripto,escrow". Vacio = todos. */
export const SOLO = (process.env.RECORRIDO_SOLO || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
