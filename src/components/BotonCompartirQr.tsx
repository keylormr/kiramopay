import { useState, type RefObject } from 'react';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { compartirImagenDeQr, dibujarTarjetaQr } from '@/utils/qrComoImagen';

interface Props {
  /** El elemento que contiene el <svg> del QR tal como esta en pantalla. */
  contenedor: RefObject<HTMLElement | null>;
  /** Quien cobra, o el monto: lo grande de la tarjeta. */
  titulo: string;
  subtitulo?: string;
  /** Que hacer con la imagen, al pie de la tarjeta. */
  pie: string;
  nombreArchivo: string;
  className?: string;
}

type Aviso = { texto: string; error: boolean } | null;

/**
 * "Compartir como imagen" de un QR propio. Dibuja una tarjeta con el QR que la
 * persona esta viendo (el mismo <svg>: lo que se comparte es lo que se muestra,
 * sin volver a generarlo) y la entrega: menu de compartir del telefono, Web
 * Share o descarga. Quien la recibe la abre desde su galeria con el escaner.
 */
export function BotonCompartirQr({ contenedor, titulo, subtitulo, pie, nombreArchivo, className }: Props) {
  const { t } = useLanguage();
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<Aviso>(null);
  const error = () => ({ texto: t('qr_imagen_error'), error: true });

  const compartir = async () => {
    setOcupado(true);
    setAviso(null);
    let resultado: Aviso = null;
    try {
      const svg = contenedor.current?.querySelector('svg');
      if (!svg) {
        resultado = error();
      } else {
        const imagen = await dibujarTarjetaQr({ svg, marca: t('app_name'), titulo, subtitulo, pie });
        const estado = await compartirImagenDeQr(imagen, nombreArchivo, titulo);
        if (estado === 'listo') resultado = { texto: t('qr_imagen_descargada'), error: false };
        else if (estado === 'solo_web') resultado = { texto: t('qr_imagen_solo_web'), error: true };
        else if (estado === 'error') resultado = error();
        // 'compartido' y 'quieto': la persona ya lo vio en el menu del sistema.
      }
    } catch {
      resultado = error();
    }
    setAviso(resultado);
    setOcupado(false);
  };

  return (
    <div className="w-full">
      <button
        type="button"
        onClick={compartir}
        disabled={ocupado}
        aria-busy={ocupado}
        className={
          className ??
          'w-full py-3 rounded-xl border border-[var(--color-border)] dark:border-[var(--color-border-dark)] uv-text-primary font-bold flex items-center justify-center gap-2 disabled:opacity-50 active:scale-[0.98] transition-transform'
        }
      >
        <Icons.Share size={18} aria-hidden="true" />
        {ocupado ? t('loading') : t('qr_compartir_imagen')}
      </button>
      {/* Siempre montado y visible (sin display:none) para que los lectores de
          pantalla anuncien el aviso al llenarse; sin texto no ocupa espacio. */}
      <p
        role="status"
        aria-live="polite"
        className={`text-sm uv-text-secondary text-center ${aviso && !aviso.error ? 'mt-2' : ''}`}
      >
        {aviso && !aviso.error ? aviso.texto : ''}
      </p>
      {aviso?.error && (
        <p role="alert" className="text-sm text-[var(--color-danger)] text-center mt-2">
          {aviso.texto}
        </p>
      )}
    </div>
  );
}
