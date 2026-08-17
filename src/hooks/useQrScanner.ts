import { useEffect, useRef, useState } from 'react';

/**
 * Lectura de códigos QR con la cámara del dispositivo.
 *
 * Estaba escrito dentro de HomeView y solo servía ahí. Se extrajo porque hay más
 * de un momento en que el usuario quiere escanear —pagar un QR desde Inicio y
 * agregar un contacto desde SINPE—, y duplicar el manejo de la cámara es la
 * forma segura de terminar con una pantalla que no apaga el sensor al cerrarse.
 *
 * El ciclo de vida está atado a `active`: mientras sea true la cámara corre y
 * el bucle de decodificación busca un código en cada cuadro; al pasar a false
 * (o al desmontar) la limpieza detiene el stream y cancela el bucle.
 *
 * @param active   si la superficie que usa el escáner está visible
 * @param onDecode recibe el texto crudo del código. Devolver `false` significa
 *                 "no es el código que espero": el escáner sigue encendido y
 *                 solo vuelve a avisar cuando aparece uno distinto. Cualquier
 *                 otro valor cierra la lectura.
 */
export function useQrScanner(active: boolean, onDecode: (raw: string) => boolean | void) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameraFailed, setCameraFailed] = useState(false);
  // Último código que el consumidor rechazó. Se ignora hasta que aparezca otro
  // distinto: sin esto, un QR ajeno frente a la cámara volvería a rechazarse
  // sesenta veces por segundo.
  const lastRejectedRef = useRef<string | null>(null);

  // El callback cambia de identidad en cada render de la vista que lo pasa. Sin
  // este ref estaría en las dependencias del efecto y la cámara se reiniciaría
  // sola varias veces por segundo.
  const onDecodeRef = useRef(onDecode);
  useEffect(() => {
    onDecodeRef.current = onDecode;
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setCameraFailed(false);
    const canvas = document.createElement('canvas');

    const start = async () => {
      try {
        // jsQR (~110KB) se carga lazy solo al abrir el escáner, fuera del chunk
        // de la vista que lo monta.
        const jsQR = (await import('jsqr')).default;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'environment' },
        });
        if (cancelled) {
          stream.getTracks().forEach((tr) => tr.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current;
        if (!video) {
          stream.getTracks().forEach((tr) => tr.stop());
          streamRef.current = null;
          return;
        }
        video.srcObject = stream;
        await video.play();
        setIsScanning(true);
        const tick = () => {
          if (cancelled) return;
          const v = videoRef.current;
          if (v && v.readyState === v.HAVE_ENOUGH_DATA && v.videoWidth > 0) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
              const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
              const code = jsQR(img.data, img.width, img.height, {
                inversionAttempts: 'dontInvert',
              });
              if (code && code.data && code.data !== lastRejectedRef.current) {
                const accepted = onDecodeRef.current(code.data);
                if (accepted !== false) {
                  // Aceptado: una sola entrega por lectura. El consumidor decide
                  // qué sigue (cerrar la hoja, cambiar de pantalla) y eso apaga
                  // la cámara.
                  cancelled = true;
                  return;
                }
                lastRejectedRef.current = code.data;
              }
            }
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        if (!cancelled) setCameraFailed(true);
      }
    };
    start();

    return () => {
      cancelled = true;
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((tr) => tr.stop());
        streamRef.current = null;
      }
      setIsScanning(false);
      lastRejectedRef.current = null;
    };
  }, [active]);

  return { videoRef, isScanning, cameraFailed };
}
