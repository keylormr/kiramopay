import { render, waitFor } from '@testing-library/react';
import { useQrScanner } from '../useQrScanner';

// Sonda mínima: monta el hook sobre un <video> real de jsdom.
const Sonda = ({ active, onDecode }: { active: boolean; onDecode: (raw: string) => void }) => {
  const { videoRef, isScanning, cameraFailed } = useQrScanner(active, onDecode);
  return (
    <div>
      <video ref={videoRef} data-testid="video" />
      <span data-testid="estado">{cameraFailed ? 'falló' : isScanning ? 'escaneando' : 'inactivo'}</span>
    </div>
  );
};

const stop = vi.fn();

function mockCamara() {
  Object.defineProperty(navigator, 'mediaDevices', {
    value: {
      getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop }] }),
    },
    configurable: true,
  });
}

beforeEach(() => {
  stop.mockReset();
  // jsdom no implementa play(); sin esto el arranque se cae antes de encender.
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
});

describe('useQrScanner', () => {
  it('no toca la cámara mientras la pantalla está cerrada', () => {
    mockCamara();
    render(<Sonda active={false} onDecode={vi.fn()} />);

    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  // El riesgo real de un escáner es dejar el sensor encendido: la luz de la
  // cámara sigue prendida después de cerrar la hoja.
  it('apaga la cámara al cerrarse', async () => {
    mockCamara();
    const { rerender } = render(<Sonda active onDecode={vi.fn()} />);

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    rerender(<Sonda active={false} onDecode={vi.fn()} />);

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  it('apaga la cámara al desmontarse', async () => {
    mockCamara();
    const { unmount } = render(<Sonda active onDecode={vi.fn()} />);

    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled());
    unmount();

    await waitFor(() => expect(stop).toHaveBeenCalled());
  });

  // Sin cámara —escritorio, permiso denegado— la pantalla tiene que decirlo
  // para que el usuario use el respaldo manual en vez de esperar de gusto.
  it('reporta la falla cuando no hay cámara disponible', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    });
    const { getByTestId } = render(<Sonda active onDecode={vi.fn()} />);

    await waitFor(() => expect(getByTestId('estado')).toHaveTextContent('falló'));
  });
});
