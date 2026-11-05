import React, { useEffect, useRef, useState } from 'react';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { useQrScanner } from '@/hooks/useQrScanner';
import { leerQrDeImagen, type LecturaDeImagen } from '@/utils/qrDesdeImagen';

interface QrScannerPanelProps {
  /** True mientras la hoja o pantalla que lo contiene esté abierta. */
  active: boolean;
  /**
   * Recibe el texto crudo del código, venga de la cámara, de una imagen o del
   * campo manual. Devolver `false` significa "ese código no me sirve": el
   * escáner sigue encendido en vez de quedarse congelado por un error ajeno al
   * usuario.
   */
  onDecode: (raw: string) => boolean | void;
  /** Qué código espera esta pantalla, en una línea. */
  hint?: string;
  /** Mensaje de error del consumidor (p. ej. "ese QR no es un contacto"). */
  error?: string;
  /** Contenido extra debajo del campo manual. */
  children?: React.ReactNode;
}

/**
 * Visor de escaneo: cámara en vivo con marco, estado, elegir una imagen de la
 * galería o de los archivos, y campo manual como respaldo cuando la cámara no
 * está disponible (navegador de escritorio, permiso denegado).
 *
 * Vive fuera de las vistas porque hay más de un momento en que se escanea
 * —pagar un QR desde Inicio, agregar un contacto desde SINPE, enviar cripto— y
 * el manejo de la cámara no debe estar copiado en cada uno.
 *
 * Las tres entradas terminan en el MISMO `onDecode`: quien recibe el texto lo
 * valida y pide su confirmación igual venga de donde venga. Una imagen que
 * llegó por chat no es de confianza, y por eso este panel nunca actúa sobre lo
 * que lee: solo lo entrega.
 */
export const QrScannerPanel: React.FC<QrScannerPanelProps> = ({
  active,
  onDecode,
  hint,
  error,
  children,
}) => {
  const { t } = useLanguage();
  const [manualCode, setManualCode] = useState('');
  const [leyendo, setLeyendo] = useState(false);
  const [errorDeImagen, setErrorDeImagen] = useState('');
  const entradaDeImagen = useRef<HTMLInputElement | null>(null);

  // Una lectura de imagen tarda (una foto grande) y la hoja se puede cerrar
  // mientras tanto. Si la persona ya se fue, el resultado no se entrega: abriría
  // una hoja de pago que nadie pidió.
  const montado = useRef(true);
  const activo = useRef(active);
  useEffect(() => {
    activo.current = active;
  });
  useEffect(() => {
    montado.current = true;
    return () => {
      montado.current = false;
    };
  }, []);

  // Cualquier código que llega —de la cámara, de una imagen o tecleado— borra el
  // aviso de la última imagen que falló: ya no describe lo que pasa.
  const entregar = (raw: string): boolean | void => {
    setErrorDeImagen('');
    return onDecode(raw);
  };

  const { videoRef, isScanning, cameraFailed } = useQrScanner(active, entregar);

  // Lo tecleado no sobrevive de una apertura a otra: la hoja que contiene al
  // panel lo desmonta al cerrarse, así que el estado nace limpio.
  const submitManual = () => {
    const raw = manualCode.trim();
    if (!raw) return;
    setManualCode('');
    entregar(raw);
  };

  const alElegirImagen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const archivo = e.target.files?.[0];
    // Se vacía siempre: con el mismo archivo elegido otra vez el navegador no
    // dispara `change`, y el segundo intento no haría nada.
    e.target.value = '';
    if (!archivo || leyendo) return;

    setErrorDeImagen('');
    setLeyendo(true);
    let lectura: LecturaDeImagen;
    try {
      lectura = await leerQrDeImagen(archivo);
    } catch {
      lectura = { ok: false, motivo: 'ilegible' };
    }
    if (!montado.current) return;
    setLeyendo(false);
    if (!activo.current) return;

    if (lectura.ok) {
      // Si el flujo rechaza lo leído (false), el aviso es suyo: ya lo puso en
      // `error`. Aquí solo se habla de lo que pasó ANTES de tener un código.
      entregar(lectura.texto);
      return;
    }
    setErrorDeImagen(t(lectura.motivo === 'sin_qr' ? 'qr_image_no_qr' : 'qr_image_unreadable'));
  };

  // El aviso más reciente gana: si una imagen falló después de un rechazo del
  // flujo, el rechazo viejo ya no es lo que la persona está mirando.
  const aviso = errorDeImagen || error;

  return (
    <div className="flex flex-col items-center py-6">
      {/* Visor — feed real de la cámara */}
      <div className="relative w-64 h-64 bg-slate-900 rounded-3xl overflow-hidden mb-6">
        <video ref={videoRef} className="absolute inset-0 w-full h-full object-cover" muted playsInline />
        <div className="absolute inset-4 border-2 border-white/30 rounded-2xl">
          <div className="absolute -top-0.5 -left-0.5 w-6 h-6 border-t-4 border-l-4 border-primary rounded-tl-lg" />
          <div className="absolute -top-0.5 -right-0.5 w-6 h-6 border-t-4 border-r-4 border-primary rounded-tr-lg" />
          <div className="absolute -bottom-0.5 -left-0.5 w-6 h-6 border-b-4 border-l-4 border-primary rounded-bl-lg" />
          <div className="absolute -bottom-0.5 -right-0.5 w-6 h-6 border-b-4 border-r-4 border-primary rounded-br-lg" />
        </div>
        {isScanning && (
          <div className="absolute left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-primary to-transparent animate-scan" />
        )}
        {!isScanning && !cameraFailed && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Icons.Scan size={48} className="text-white/20" />
          </div>
        )}
      </div>

      {/* Estado */}
      <div className="text-center mb-4 px-4">
        {leyendo ? (
          <p className="uv-text-muted" role="status">{t('qr_reading_image')}</p>
        ) : cameraFailed ? (
          <p className="text-[var(--color-danger)] text-sm">{t('camera_unavailable')}</p>
        ) : (
          <p className="uv-text-muted">{isScanning ? t('scanning') : t('point_camera')}</p>
        )}
        {hint && <p className="text-xs uv-text-muted mt-2">{hint}</p>}
        {aviso && (
          <p className="text-[var(--color-danger)] text-sm mt-2" aria-live="polite">
            {aviso}
          </p>
        )}
      </div>

      {/* Imagen de la galería o de los archivos: el QR que llegó por chat. Sin
          `capture`: eso abriría la cámara y no la galería. */}
      <div className="w-full max-w-xs mb-5">
        <input
          ref={entradaDeImagen}
          data-testid="qr-image-input"
          type="file"
          accept="image/*"
          className="hidden"
          tabIndex={-1}
          aria-hidden="true"
          disabled={leyendo}
          onChange={alElegirImagen}
        />
        <button
          type="button"
          onClick={() => entradaDeImagen.current?.click()}
          disabled={leyendo}
          className="w-full py-3 rounded-xl bg-[var(--color-primary-soft)] text-[var(--color-primary)] font-bold text-sm flex items-center justify-center gap-2 active:scale-[0.98] transition-transform disabled:opacity-60 uv-focus-ring"
        >
          {leyendo ? (
            <div
              className="w-4 h-4 rounded-full border-2 border-[var(--color-primary)]/30 border-t-[var(--color-primary)] animate-spin"
              aria-hidden="true"
            />
          ) : (
            <Icons.Image size={18} aria-hidden="true" />
          )}
          {t('qr_pick_image')}
        </button>
        <p className="text-xs uv-text-muted text-center mt-2">{t('qr_pick_image_hint')}</p>
      </div>

      {/* Respaldo manual: pegar el contenido del QR */}
      <div className="w-full max-w-xs space-y-2">
        <label className="text-xs text-gray-500 font-medium" htmlFor="qr-manual-code">
          {t('enter_code_manually')}
        </label>
        <div className="flex gap-2">
          <input
            id="qr-manual-code"
            type="text"
            value={manualCode}
            onChange={(e) => setManualCode(e.target.value)}
            placeholder={t('qr_code')}
            className="flex-1 bg-[var(--color-surface-muted)] dark:bg-[var(--color-surface-muted-dark)] rounded-xl px-3 py-2 text-sm outline-none uv-text-primary"
          />
          <button
            onClick={submitManual}
            disabled={!manualCode.trim()}
            className="px-4 rounded-xl bg-[var(--color-primary)] text-white font-bold text-sm disabled:opacity-50"
          >
            {t('continue')}
          </button>
        </div>
      </div>

      {children}
    </div>
  );
};
