import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { PlansView } from '../PlansView';

const { registrarInteres } = vi.hoisted(() => ({ registrarInteres: vi.fn() }));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ plans: { registrarInteres } }),
}));

function montar() {
  return render(
    <LanguageProvider>
      <PlansView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

// La fila recomendada de la calculadora se marca con aria-current, que es la
// misma senal que lee un lector de pantalla: no hay un gancho solo de prueba.
function filaRecomendada(): HTMLElement {
  const fila = document.querySelector('[aria-current="true"]');
  if (!fila) throw new Error('la calculadora no marco ninguna fila como recomendada');
  return fila as HTMLElement;
}

async function escribirCobrado(monto: string) {
  const user = userEvent.setup();
  const campo = screen.getByLabelText('Cobrado al mes en el panel de comercio', {
    selector: 'input[type="text"]',
  });
  await user.clear(campo);
  await user.type(campo, monto);
}

describe('PlansView', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    registrarInteres.mockReset();
  });

  describe('la calculadora', () => {
    it('recomienda el plan gratuito con 3.000 cobrados al mes', async () => {
      montar();
      await escribirCobrado('3000');

      const fila = filaRecomendada();
      expect(fila).toHaveTextContent('Kiramo');
      expect(fila).not.toHaveTextContent('Negocio');
      expect(fila).not.toHaveTextContent('Cima');
      // 0.5% de 3.000 = 15, contra los 34.99 de cuota del plan mas barato.
      expect(fila).toHaveTextContent('$15.00');
      expect(screen.getByRole('status')).toHaveTextContent('te conviene el plan gratuito');
    });

    it('recomienda Kiramo Negocio con 15.000 cobrados al mes', async () => {
      montar();
      await escribirCobrado('15000');

      const fila = filaRecomendada();
      expect(fila).toHaveTextContent('Kiramo Negocio');
      // 34.99 de cuota + 0.25% sobre los 3.000 que exceden los 12.000 = 42.49.
      expect(fila).toHaveTextContent('$42.49');
      expect(screen.getByRole('status')).toHaveTextContent('Kiramo Negocio');
    });

    it('arranca en 7.000, el punto donde la cuota alcanza a la comision', () => {
      montar();
      expect(
        screen.getByLabelText('Cobrado al mes en el panel de comercio', {
          selector: 'input[type="text"]',
        }),
      ).toHaveValue('7,000');
    });
  });

  describe('el registro de interes', () => {
    it('registra una sola vez aunque se toque el boton dos veces', async () => {
      // Promesa que no se resuelve: sin la guarda sincronica, el segundo toque
      // entraria antes de que el boton llegue a deshabilitarse.
      registrarInteres.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      montar();

      const boton = screen.getByRole('button', { name: /Me interesa Kiramo Negocio/i });
      await user.click(boton);
      await user.click(boton);

      expect(registrarInteres).toHaveBeenCalledTimes(1);
      expect(registrarInteres).toHaveBeenCalledWith('negocio');
    });

    it('pasa a "anotado" y ya no se puede reenviar', async () => {
      registrarInteres.mockResolvedValue({
        success: true,
        data: { plan: 'cima', registeredAt: '2026-09-04T00:00:00Z' },
      });
      const user = userEvent.setup();
      montar();

      await user.click(screen.getByRole('button', { name: /Me interesa Kiramo Cima/i }));

      const anotado = await screen.findByRole('button', { name: /Anotado\. Te contactamos\. Kiramo Cima/i });
      expect(anotado).toBeDisabled();

      await user.click(anotado);
      expect(registrarInteres).toHaveBeenCalledTimes(1);
    });

    it('avisa cuando el registro falla y deja volver a intentarlo', async () => {
      registrarInteres.mockResolvedValue({
        success: false,
        error: { code: 'INTEREST_FAILED', message: 'boom' },
      });
      const user = userEvent.setup();
      montar();

      await user.click(screen.getByRole('button', { name: /Me interesa Kiramo Negocio/i }));

      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo anotar tu interés');
      expect(screen.getByRole('button', { name: /Me interesa Kiramo Negocio/i })).toBeEnabled();
    });
  });

  describe('la honestidad de la pagina', () => {
    it('muestra el bloque de lo que no incluye, con los cinco limites', () => {
      montar();

      expect(screen.getByRole('heading', { name: 'Lo que no incluye' })).toBeInTheDocument();
      expect(screen.getByText(/no es emisor de tarjetas/)).toBeInTheDocument();
      expect(screen.getByText(/No hay seguros de ningún tipo/)).toBeInTheDocument();
      expect(screen.getByText(/no pagan intereses ni rendimiento/)).toBeInTheDocument();
      expect(screen.getByText(/licencia de proveedor de activos virtuales/)).toBeInTheDocument();
      expect(screen.getByText(/fondo de garantía de depósitos/)).toBeInTheDocument();
    });

    it('avisa junto al boton que todavia no se puede pagar en la app', () => {
      montar();
      expect(screen.getAllByText(/Todavía no se puede pagar dentro de la app/)).toHaveLength(2);
    });

    it('no ofrece contratar el plan gratuito: dice que ya se esta usando', () => {
      montar();
      expect(screen.getByText('Es el plan que tienes hoy.')).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: /Me interesa/i })).toHaveLength(2);
    });
  });

  describe('el selector mensual y anual', () => {
    it('cambia el precio mostrado y ofrece los dos meses gratis', async () => {
      const user = userEvent.setup();
      montar();

      // El precio se busca dentro de la tarjeta: la calculadora tambien muestra
      // $34.99 en su fila de Negocio con los 7.000 que trae por defecto.
      const tarjeta = () =>
        within(screen.getByRole('heading', { name: 'Kiramo Negocio' }).closest('article') as HTMLElement);

      expect(tarjeta().getByText('$34.99')).toBeInTheDocument();
      expect(tarjeta().getByText('O $349.90 al año, con dos meses gratis.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Anual' }));

      expect(tarjeta().getByText('$349.90')).toBeInTheDocument();
      expect(tarjeta().getByText('Equivale a $29.16 al mes. Dos meses gratis.')).toBeInTheDocument();
    });
  });
});
