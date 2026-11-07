
import {
  Home,
  CreditCard,
  Repeat,
  ScanLine,
  LayoutGrid,
  User,
  Bell,
  BellOff,
  BellRing,
  Trash2,
  Search,
  Lock,
  Unlock,
  WifiOff,
  Moon,
  Sun,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownUp,
  Wallet,
  QrCode,
  ChevronRight,
  ChevronLeft,
  Snowflake,
  Settings,
  ShieldCheck,
  LogOut,
  SignalHigh,
  Bitcoin,
  Plus,
  Minus,
  SlidersHorizontal,
  Eye,
  EyeOff,
  CheckCircle2,
  X,
  Receipt,
  Undo2,
  Landmark,
  Phone,
  Smartphone,
  Share2,
  Copy,
  Clock,
  History,
  Star,
  MapPin,
  Fingerprint,
  Edit3,
  Shield,
  ArrowRight,
  FileText,
  Zap,
  Droplets,
  Tv,
  Building2,
  Car,
  UtensilsCrossed,
  ShoppingCart,
  Film,
  Gift,
  Percent,
  Globe,
  CreditCard as CardIcon,
  Banknote,
  TrendingUp,
  PiggyBank,
  Users,
  HelpCircle,
  Info,
  AlertCircle,
  AlertTriangle,
  CheckCircle,
  XCircle,
  RefreshCw,
  Download,
  Upload,
  Camera,
  Image,
  Mic,
  Volume2,
  Wifi,
  Bluetooth,
  Battery,
  Navigation,
  Compass,
  Target,
  Flag,
  Award,
  Trophy,
  Heart,
  Bookmark,
  Tag,
  Hash,
  AtSign,
  Mail,
  MessageCircle,
  Send,
  Inbox,
  Circle,
  CalendarDays,
  TrendingDown,
} from 'lucide-react';
import type { LucideIcon, LucideProps } from 'lucide-react';
import { forwardRef } from 'react';

export const Icons = {
  // Navigation
  Home,
  Calendar: CalendarDays,
  TrendingDown,
  Card: CreditCard,
  Exchange: Repeat,
  Scan: ScanLine,
  Apps: LayoutGrid,
  Profile: User,
  Bell,
  BellOff,
  BellRing,
  Search,
  ChevronRight,
  ChevronLeft,
  ArrowRight,

  // Actions
  Send: ArrowUpRight,
  Receive: ArrowDownLeft,
  ArrowUpRight,
  ArrowDownLeft,
  ArrowDownUp,
  Plus,
  Minus,
  Close: X,
  X,
  Check: CheckCircle2,
  CheckCircle,
  Edit: Edit3,
  Trash: Trash2,
  Copy,
  Share: Share2,
  Download,
  Upload,
  RefreshCw,
  Circle,

  // Finance
  Wallet,
  Bank: Landmark,
  Receipt,
  Undo2,
  Banknote,
  TrendingUp,
  PiggyBank,
  Bitcoin,
  Percent,

  // Security
  Lock,
  Unlock,
  Shield: ShieldCheck,
  ShieldIcon: Shield,
  Fingerprint,
  Eye,
  EyeOff,
  AlertTriangle,

  // Settings
  Settings,
  Sliders: SlidersHorizontal,
  Offline: WifiOff,
  Moon,
  Sun,
  Globe,
  LogOut,

  // Communication
  Phone,
  Smartphone,
  Mail,
  MessageCircle,
  SendMessage: Send,
  Inbox,
  AtSign,

  // Status
  SignalHigh,
  Wifi,
  Battery,
  Clock,
  History,
  AlertCircle,
  Info,
  HelpCircle,
  XCircle,

  // QR
  Qr: QrCode,
  QrCode,
  Camera,

  // Services
  FileText,
  Zap,
  Droplets,
  Tv,
  Building2,

  // Marketplace
  Car,
  UtensilsCrossed,
  ShoppingCart,
  Film,
  Gift,
  Tag,

  // Location
  MapPin,
  Navigation,
  Compass,
  Target,
  Flag,

  // Social
  Star,
  Heart,
  Bookmark,
  Users,
  User,
  Award,
  Trophy,

  // Misc
  Freeze: Snowflake,
  Image,
  Mic,
  Volume2,
  Bluetooth,
  Hash,
  CardIcon,
};

/* ═══════════════════════════════════════════════════════════════════════════
   Iconos de linea propios (rediseno 2026-11)
   ───────────────────────────────────────────────────────────────────────────
   Trazo de 1,75 y un cuerpo con relleno suave del mismo color (16 % por
   defecto; la navegacion lo sube a 22 % en el elemento activo con la variable
   --kp-icono-relleno). Reemplazan a los emojis que hacian de icono: un emoji
   cambia de dibujo en cada sistema, no sigue el color del tema y en Windows
   algunos ni existen. Aceptan las mismas props que un icono de lucide (size,
   strokeWidth, className, color), asi que se usan igual.

   Cada icono son dos trazos sobre una reticula de 24: `cuerpo` (contorno con
   relleno) y `lineas` (detalles sin relleno).
   ═══════════════════════════════════════════════════════════════════════════ */

interface Trazos {
  cuerpo: string;
  lineas?: string;
}

function iconoDeLinea(nombre: string, { cuerpo, lineas }: Trazos): LucideIcon {
  const Icono = forwardRef<SVGSVGElement, LucideProps>(function IconoDeLinea(
    { size = 24, strokeWidth = 1.75, absoluteStrokeWidth, color = 'currentColor', className, ...rest },
    ref,
  ) {
    const trazo = absoluteStrokeWidth ? (Number(strokeWidth) * 24) / Number(size) : strokeWidth;
    const accesible = rest['aria-label'] || rest['aria-labelledby'] || rest.role ? {} : { 'aria-hidden': true as const };
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color}
        strokeWidth={trazo}
        strokeLinecap="round"
        strokeLinejoin="round"
        focusable="false"
        data-icono={nombre}
        className={['kp-icono', className].filter(Boolean).join(' ')}
        {...accesible}
        {...rest}
      >
        <path d={cuerpo} fill={color} style={{ fillOpacity: 'var(--kp-icono-relleno, 0.16)' }} />
        {lineas ? <path d={lineas} /> : null}
      </svg>
    );
  });
  Icono.displayName = nombre;
  return Icono as unknown as LucideIcon;
}

const CIRCULO = 'M3.5 12a8.5 8.5 0 1 0 17 0a8.5 8.5 0 1 0-17 0z';
const BOLSA = 'M5 8h14l-1.2 11a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8z';
const CASA = 'M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-6H9v6H5.5A1.5 1.5 0 0 1 4 19z';
const CUADRO = 'M9 3h6a6 6 0 0 1 6 6v6a6 6 0 0 1-6 6H9a6 6 0 0 1-6-6V9a6 6 0 0 1 6-6z';

export const IconosLinea = {
  // Navegacion principal
  Inicio: iconoDeLinea('Inicio', { cuerpo: CASA, lineas: 'M9 20.5v-6h6v6' }),
  Sinpe: iconoDeLinea('Sinpe', {
    cuerpo: 'M9.2 2.5h5.6a3.2 3.2 0 0 1 3.2 3.2v12.6a3.2 3.2 0 0 1-3.2 3.2H9.2A3.2 3.2 0 0 1 6 18.3V5.7a3.2 3.2 0 0 1 3.2-3.2z',
    lineas: 'M10.5 18h3M9.6 10.6a3.4 3.4 0 0 1 4.8 0M8.2 8.4a5.6 5.6 0 0 1 7.6 0',
  }),
  Cripto: iconoDeLinea('Cripto', {
    cuerpo: 'M12 2.8l7.8 4.5v9.4L12 21.2l-7.8-4.5V7.3z',
    lineas: 'M10 8.6v6.8M10 8.6h3a1.7 1.7 0 0 1 0 3.4h-3 3.4a1.7 1.7 0 0 1 0 3.4H10M11.6 7.2v1.4M11.6 15.4v1.4',
  }),
  Servicios: iconoDeLinea('Servicios', {
    cuerpo: 'M7 3h10a2 2 0 0 1 2 2v16l-3-2-2 2-2-2-2 2-2-2-3 2V5a2 2 0 0 1 2-2z',
    lineas: 'M9 8h6M9 12h6',
  }),
  Perfil: iconoDeLinea('Perfil', {
    cuerpo: 'M12 3.5a4 4 0 1 0 0 8a4 4 0 1 0 0-8z',
    lineas: 'M4.5 20.5c1-3.6 4-5.5 7.5-5.5s6.5 1.9 7.5 5.5',
  }),
  Reportes: iconoDeLinea('Reportes', {
    cuerpo: 'M5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4z',
    lineas: 'M8 16v-3M12 16V8M16 16v-5.5',
  }),
  Movimientos: iconoDeLinea('Movimientos', {
    cuerpo: 'M6 3.5h12A1.5 1.5 0 0 1 19.5 5v14a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V5A1.5 1.5 0 0 1 6 3.5z',
    lineas: 'M8 8.5h8M8 12h8M8 15.5h5',
  }),
  Ajustes: iconoDeLinea('Ajustes', {
    cuerpo: 'M15 4.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM9 14.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z',
    lineas: 'M4 7h8.5M17.5 7H20M4 17h2.5M11.5 17H20',
  }),

  // Accesos del menu lateral
  Metas: iconoDeLinea('Metas', {
    cuerpo: CIRCULO,
    lineas: 'M12 7.5a4.5 4.5 0 1 0 4.5 4.5M12 12l5.5-5.5M15 6.5h2.5V9',
  }),
  Tarjeta: iconoDeLinea('Tarjeta', {
    cuerpo: 'M5.5 5h13a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3h-13a3 3 0 0 1-3-3V8a3 3 0 0 1 3-3z',
    lineas: 'M2.5 9.5h19M6 15h4',
  }),
  Dispositivos: iconoDeLinea('Dispositivos', {
    cuerpo: 'M6 4.5h12a2 2 0 0 1 2 2v9H4v-9a2 2 0 0 1 2-2z',
    lineas: 'M2.5 18.5h19',
  }),
  // Boton del menu lateral: el panel relleno es el menu y la flecha dice lo
  // que pasa al tocar (plegarlo hacia la izquierda o desplegarlo).
  MenuPlegar: iconoDeLinea('MenuPlegar', {
    cuerpo: 'M5.5 4.5h4v15h-4a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z',
    lineas: 'M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM9.5 4.5v15M16 9.5L13.5 12l2.5 2.5',
  }),
  MenuDesplegar: iconoDeLinea('MenuDesplegar', {
    cuerpo: 'M5.5 4.5h4v15h-4a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2z',
    lineas: 'M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2zM9.5 4.5v15M14 9.5l2.5 2.5-2.5 2.5',
  }),

  // Acciones de dinero
  Enviar: iconoDeLinea('Enviar', { cuerpo: CUADRO, lineas: 'M9.5 14.5l5-5M10.5 9.5h4v4' }),
  Recibir: iconoDeLinea('Recibir', { cuerpo: CUADRO, lineas: 'M14.5 9.5l-5 5M13.5 14.5h-4v-4' }),
  Banco: iconoDeLinea('Banco', {
    cuerpo: 'M3.5 8.5L12 4l8.5 4.5z',
    lineas: 'M5.5 11.5v6M9.8 11.5v6M14.2 11.5v6M18.5 11.5v6M3.5 20.5h17',
  }),

  // Categorias del mercado
  Todo: iconoDeLinea('Todo', {
    cuerpo:
      'M5.5 4h3A1.5 1.5 0 0 1 10 5.5v3A1.5 1.5 0 0 1 8.5 10h-3A1.5 1.5 0 0 1 4 8.5v-3A1.5 1.5 0 0 1 5.5 4zM15.5 4h3A1.5 1.5 0 0 1 20 5.5v3a1.5 1.5 0 0 1-1.5 1.5h-3A1.5 1.5 0 0 1 14 8.5v-3A1.5 1.5 0 0 1 15.5 4zM5.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3A1.5 1.5 0 0 1 8.5 20h-3A1.5 1.5 0 0 1 4 18.5v-3A1.5 1.5 0 0 1 5.5 14zM15.5 14h3a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-3a1.5 1.5 0 0 1-1.5-1.5v-3a1.5 1.5 0 0 1 1.5-1.5z',
  }),
  Transporte: iconoDeLinea('Transporte', {
    cuerpo: 'M4 16.5v-4l2-5a2 2 0 0 1 1.9-1.3h8.2A2 2 0 0 1 18 7.5l2 5v4z',
    lineas: 'M4 16.5v2.5M20 16.5v2.5M4.5 12.5h15M7.5 14.5h.01M16.5 14.5h.01',
  }),
  Comida: iconoDeLinea('Comida', {
    cuerpo: 'M3.5 11.5h17a8.5 8.5 0 0 1-17 0z',
    lineas: 'M8 21h8M9 8.5c0-1.5 1-1.5 1-3M12.5 8.5c0-1.5 1-1.5 1-3M16 8.5c0-1.5 1-1.5 1-3',
  }),
  Super: iconoDeLinea('Super', { cuerpo: BOLSA, lineas: 'M9 10V7a3 3 0 0 1 6 0v3' }),
  Ocio: iconoDeLinea('Ocio', {
    cuerpo: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z',
    lineas: 'M14 6v2.5M14 11v2M14 15.5V18',
  }),

  // Pasos de un pedido de comida
  Cocinando: iconoDeLinea('Cocinando', {
    cuerpo: 'M4.5 11.5h15v5a3.5 3.5 0 0 1-3.5 3.5H8a3.5 3.5 0 0 1-3.5-3.5z',
    lineas: 'M2.5 11.5h19M8.6 8.5c0-1.3.9-1.4.9-2.8M11.7 8.5c0-1.3.9-1.4.9-2.8M14.8 8.5c0-1.3.9-1.4.9-2.8',
  }),
  PedidoListo: iconoDeLinea('PedidoListo', { cuerpo: BOLSA, lineas: 'M9 8V7a3 3 0 0 1 6 0v1M9.5 14.2l1.9 1.9 3.3-3.5' }),
  Moto: iconoDeLinea('Moto', {
    cuerpo: 'M4 6.5h6v5H4z',
    lineas:
      'M3.5 17.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M15.5 17.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M8.5 17.5h4.5l2.5-4.5M3.5 14.5h9.5M18 15L15.6 6.5H13',
  }),
  // Casa sin puerta: la marca de entregado va donde estaria la puerta.
  Entregado: iconoDeLinea('Entregado', {
    cuerpo: 'M4 10.5L12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z',
    lineas: 'M9.2 14.4l2 2 3.6-3.9',
  }),

  // Pasos de un viaje
  Confirmado: iconoDeLinea('Confirmado', { cuerpo: CIRCULO, lineas: 'M8.5 12.3l2.4 2.4 4.6-4.9' }),
  Ruta: iconoDeLinea('Ruta', {
    cuerpo: 'M18 4a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
    lineas: 'M6 16a2 2 0 1 0 0 4a2 2 0 1 0 0-4zM8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16',
  }),
  Llegada: iconoDeLinea('Llegada', { cuerpo: 'M6 4.5h11l-2.2 4 2.2 4H6z', lineas: 'M6 21V4.5' }),
} satisfies Record<string, LucideIcon>;

export type IconoDeLinea = LucideIcon;
