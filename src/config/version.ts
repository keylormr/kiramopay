// Sistema de versionado de KiramoPay
// Cuando el usuario diga "Versionar", incrementar la version y agregar entrada al changelog

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

// Helper para obtener version formateada
export const getVersionString = (): string => {
  return `v${APP_VERSION.current.version} (Build ${APP_VERSION.current.buildNumber})`;
};

// Helper para obtener todas las versiones (actual + historial)
export const getAllVersions = (): VersionInfo[] => {
  return [APP_VERSION.current, ...APP_VERSION.history];
};
