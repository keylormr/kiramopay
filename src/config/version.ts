// Sistema de versionado de KiramoPay.
//
// La VERSION y los datos del build ya no se escriben a mano: salen de
// package.json y de la plataforma que compila, inyectados por el `define` de
// vite.config.ts. Lo único que se mantiene a mano es el CHANGELOG de abajo,
// que es editorial: describe los cambios en lenguaje de usuario.
//
// Al cortar una versión: subir "version" en package.json y agregar aquí su
// entrada de changelog. El número de build y la fecha se resuelven solos.

/** Versión del paquete (package.json), fijada en tiempo de build. */
export const BUILD_VERSION: string = __APP_VERSION__;

/** Commit con el que se compiló: lo aporta Vercel o GitHub Actions. */
export const BUILD_SHA: string = __BUILD_SHA__;

/** Momento del build, en ISO 8601. */
export const BUILD_DATE: string = __BUILD_DATE__;

export interface VersionInfo {
  version: string;
  buildNumber: number;
  releaseDate: string;
  changes: string[];
}

export interface AppVersion {
  current: VersionInfo;
  history: VersionInfo[];
}

export const APP_VERSION: AppVersion = {
  current: {
    version: '2.0.0',
    buildNumber: 3,
    releaseDate: '2026-02-16',
    changes: [
      'Proteccion avanzada de cuenta: bloqueo automatico tras intentos fallidos',
      'Verificacion de sesion en tiempo real para mayor seguridad',
      'Registro de actividad para detectar accesos no autorizados',
      'Carga mas rapida: las pantallas se cargan bajo demanda',
      'Optimizacion de estilos para mejor rendimiento',
      'Notificaciones push para transferencias y alertas de precios',
      'Tasas de cambio actualizadas en tiempo real',
      'Precios crypto mas estables con proteccion ante fallos del proveedor',
      'Notificaciones personalizadas por usuario via WebSocket',
      'Deep links: abrir pagos y transferencias desde enlaces externos',
      'Autenticacion biometrica obligatoria en transacciones grandes',
      'Preparacion para Google Play Store',
      'Restructuracion de base de datos para mayor escalabilidad',
      'Sistema de respaldos automaticos diarios',
      'Mejoras de conexion a base de datos para multiples usuarios simultaneos',
    ],
  },
  history: [
    {
      version: '1.1.0',
      buildNumber: 2,
      releaseDate: '2024-12-30',
      changes: [
        'Sistema de autenticacion con cedula y PIN',
        'Soporte para biometria (huella/Face ID)',
        'Persistencia local de datos',
        'Vista de notificaciones funcional',
        'Seccion de preguntas frecuentes',
        'Agregar contactos SINPE con banco',
        'Botones de copiar y compartir funcionales',
        'Historial de pagos de servicios y recargas',
        'Sistema de versionado con changelog',
        'Confirmacion PIN para cambios de seguridad',
      ],
    },
    {
      version: '1.0.0',
      buildNumber: 1,
      releaseDate: '2024-12-28',
      changes: [
        'Version inicial de KiramoPay',
        'Pantalla principal con balance',
        'SINPE Movil: enviar y recibir dinero',
        'Pago de servicios (ICE, AyA, CNFL)',
        'Recargas telefonicas (Kolbi, Claro, Movistar)',
        'Marketplace: Uber, DiDi, Uber Eats',
        'Perfil de usuario con configuraciones',
        'Modo oscuro',
        'Tarjetas virtuales',
      ],
    },
  ],
};

// Version formateada para la interfaz: sale del build, no del changelog.
export const getVersionString = (): string => `v${BUILD_VERSION} (${BUILD_SHA})`;

// Fecha del build en formato legible, para la pantalla "Acerca de".
export const getBuildDate = (locale = 'es-CR'): string => {
  const d = new Date(BUILD_DATE);
  return Number.isNaN(d.getTime())
    ? BUILD_DATE
    : d.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
};

// Helper para obtener todas las versiones (actual + historial)
export const getAllVersions = (): VersionInfo[] => {
  return [APP_VERSION.current, ...APP_VERSION.history];
};
