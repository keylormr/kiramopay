import React, { useState } from 'react';
import { Icons } from './Icons';
import { useLanguage } from '@/i18n/LanguageContext';
import { useQrScanner } from '@/hooks/useQrScanner';

interface QrScannerPanelProps {
  /** True mientras la hoja o pantalla que lo contiene esté abierta. */
  active: boolean;
  /**
   * Recibe el texto crudo del código, venga de la cámara o del campo manual.
   * Devolver `false` significa "ese código no me sirve": el escáner sigue
   * encendido en vez de quedarse congelado por un error ajeno al usuario.
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
 * Visor de escaneo: cámara en vivo con marco, estado, y campo manual como
 * respaldo cuando la cámara no está disponible (navegador de escritorio,
 * permiso denegado).
 *
 * Vive fuera de las vistas porque hay dos momentos distintos en que se escanea
 * —pagar un QR desde Inicio y agregar un contacto desde SINPE— y el manejo de
 * la cámara no debe estar copiado en cada uno.
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

  const { videoRef, isScanning, cameraFailed } = useQrScanner(active, onDecode);

  // Lo tecleado no sobrevive de una apertura a otra: la hoja que contiene al
  // panel lo desmonta al cerrarse, así que el estado nace limpio.
  const submitManual = () => {
    const raw = manualCode.trim();
    if (!raw) return;
    setManualCode('');
    onDecode(raw);
  };

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
      <div className="text-center mb-6 px-4">
        {cameraFailed ? (
          <p className="text-[var(--color-danger)] text-sm">{t('camera_unavailable')}</p>
        ) : (
          <p className="uv-text-muted">{isScanning ? t('scanning') : t('point_camera')}</p>
        )}
        {hint && <p className="text-xs uv-text-muted mt-2">{hint}</p>}
        {error && (
          <p className="text-[var(--color-danger)] text-sm mt-2" aria-live="polite">
            {error}
          </p>
        )}
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
