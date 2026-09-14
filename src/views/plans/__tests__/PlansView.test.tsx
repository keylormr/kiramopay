import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { useAuthStore } from '@/stores/auth.store';
import { olvidarTarifas } from '@/hooks/usePlanes';
import { TARIFAS_POR_DEFECTO } from '@/utils/planes';
import type { Tarifas } from '@/api/repositories/plans.repository';
import type { User } from '@/types/auth.types';
import { PlansView } from '../PlansView';

const { registrarInteres, getTarifas } = vi.hoisted(() => ({
  registrarInteres: vi.fn(),
  getTarifas: vi.fn(),
}));

vi.mock('@/api', () => ({
  getApiLayer: () => ({ plans: { registrarInteres, getTarifas } }),
}));

function conPlan(plan: User['plan']) {
  useAuthStore.setState({
    user: { id: 'u1', phone: '', firstName: 'Keilor', lastName: 'M', kycLevel: 1, createdAt: '', plan } as User,
  });
}

function montar() {
  return render(
    <LanguageProvider>
      <PlansView onClose={vi.fn()} />
    </LanguageProvider>,
  );
}

// Los valores de una fila de la comparacion, en el orden Gratis, Plus, Pro.
function fila(nombre: string): (string | null)[] {
  const encabezado = screen.getByRole('rowheader', { name: nombre });
  return within(encabezado.closest('tr') as HTMLElement).getAllByRole('cell').map((c) => c.textContent);
}

const copia = (): Tarifas => JSON.parse(JSON.stringify(TARIFAS_POR_DEFECTO));

describe('PlansView', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
    registrarInteres.mockReset();
    getTarifas.mockReset();
    getTarifas.mockResolvedValue({ success: true, data: TARIFAS_POR_DEFECTO });
    olvidarTarifas();
    conPlan('free');
  });

  describe('para ti', () => {
    it('compara Gratis, Plus y Pro con sus precios y los tres topes reales', async () => {
      montar();

      const encabezados = await screen.findAllByRole('columnheader');
      expect(encabezados.map((h) => h.textContent)).toEqual([
        expect.stringContaining('Gratis'),
        expect.stringContaining('Plus'),
        expect.stringContaining('Pro'),
      ]);
      expect(within(encabezados[0]).getByText('$0')).toBeInTheDocument();
      expect(within(encabezados[1]).getByText('$11.99')).toBeInTheDocument();
      expect(within(encabezados[2]).getByText('$34.99')).toBeInTheDocument();

      expect(fila('Consultas al asistente por día')).toEqual(['2', '15', '50']);
      expect(fila('Metas de ahorro activas')).toEqual(['3', '10', 'Sin tope']);
      expect(fila('Tarjetas virtuales activas')).toEqual(['1', '3', '5']);
    });

    it('muestra los topes que publica el servidor, no los escritos en la app', async () => {
      const tarifas = copia();
      tarifas.planes.free.topes.metas = 5;
      // Sin asistente configurado el servidor no publica esa fila.
      for (const p of ['free', 'plus', 'pro'] as const) delete tarifas.planes[p].topes.asistente;
      getTarifas.mockResolvedValue({ success: true, data: tarifas });

      montar();

      expect(await screen.findByRole('rowheader', { name: 'Metas de ahorro activas' })).toBeInTheDocument();
      await waitFor(() => expect(fila('Metas de ahorro activas')).toEqual(['5', '10', 'Sin tope']));
      expect(screen.queryByRole('rowheader', { name: 'Consultas al asistente por día' })).toBeNull();
    });

    it('marca el plan del perfil y no ofrece anotarse al plan que ya se tiene', async () => {
      conPlan('plus');
      montar();

      const encabezados = await screen.findAllByRole('columnheader');
      expect(within(encabezados[1]).getByText('Tu plan')).toBeInTheDocument();
      expect(within(encabezados[0]).queryByText('Tu plan')).toBeNull();
      expect(within(encabezados[2]).getByText('Próximamente')).toBeInTheDocument();

      expect(screen.queryByRole('button', { name: /Avisarme cuando esté disponible Plus/ })).toBeNull();
      expect(screen.getByRole('button', { name: /Avisarme cuando esté disponible Pro/ })).toBeInTheDocument();
    });

    it('con Pro no ofrece anotarse a un plan personal inferior, solo a Analitica', async () => {
      conPlan('pro');
      montar();

      const encabezados = await screen.findAllByRole('columnheader');
      expect(within(encabezados[2]).getByText('Tu plan')).toBeInTheDocument();
      const botones = screen.getAllByRole('button', { name: /Avisarme cuando esté disponible/ });
      expect(botones.map((b) => b.getAttribute('aria-label'))).toEqual(['Avisarme cuando esté disponible Analítica']);
    });

    it('con el plan Gratis ofrece anotarse a Plus, a Pro y a Analitica, y ninguno es Gratis', async () => {
      montar();
      const botones = await screen.findAllByRole('button', { name: /Avisarme cuando esté disponible/ });
      expect(botones.map((b) => b.getAttribute('aria-label'))).toEqual([
        'Avisarme cuando esté disponible Plus',
        'Avisarme cuando esté disponible Pro',
        'Avisarme cuando esté disponible Analítica',
      ]);
    });
  });

  describe('el registro de interes', () => {
    it('registra una sola vez aunque se toque el boton dos veces', async () => {
      // Promesa que no se resuelve: sin la guarda sincronica, el segundo toque
      // entraria antes de que el boton llegue a deshabilitarse.
      registrarInteres.mockReturnValue(new Promise(() => {}));
      const user = userEvent.setup();
      montar();

      const boton = await screen.findByRole('button', { name: /Avisarme cuando esté disponible Plus/ });
      await user.click(boton);
      await user.click(boton);

      expect(registrarInteres).toHaveBeenCalledTimes(1);
      expect(registrarInteres).toHaveBeenCalledWith('plus');
    });

    it('pasa a "anotado" y ya no se puede reenviar', async () => {
      registrarInteres.mockResolvedValue({ success: true, data: { plan: 'analitica', registeredAt: '2026-09-13T00:00:00Z' } });
      const user = userEvent.setup();
      montar();

      await user.click(await screen.findByRole('button', { name: /Avisarme cuando esté disponible Analítica/ }));

      const anotado = await screen.findByRole('button', { name: 'Anotado. Te avisamos. Analítica' });
      expect(anotado).toBeDisabled();
      await user.click(anotado);
      expect(registrarInteres).toHaveBeenCalledTimes(1);
      expect(registrarInteres).toHaveBeenCalledWith('analitica');
    });

    it('avisa cuando el registro falla y deja volver a intentarlo', async () => {
      registrarInteres.mockResolvedValue({ success: false, error: { code: 'INTEREST_FAILED', message: 'boom' } });
      const user = userEvent.setup();
      montar();

      await user.click(await screen.findByRole('button', { name: /Avisarme cuando esté disponible Pro/ }));

      expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo anotar tu interés');
      expect(screen.getByRole('button', { name: /Avisarme cuando esté disponible Pro/ })).toBeEnabled();
    });
  });

  describe('para tu comercio', () => {
    it('dice la comision, la promocion de entrada y Analitica como proximamente', async () => {
      montar();

      expect(await screen.findByText('0.5%')).toBeInTheDocument();
      expect(screen.getByText('El QR entre personas es gratis.')).toBeInTheDocument();
      expect(screen.getByText('Comercios nuevos: 0.25% los primeros 3 meses')).toBeInTheDocument();
      expect(screen.getByText(/Después se cobra 0\.5%\. Si tu comisión fijada es menor, se respeta la menor\./)).toBeInTheDocument();
      expect(screen.getByText(/ya estaban aprobados antes de la promoción no la reciben/)).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Analítica' })).toBeInTheDocument();
      expect(screen.getByText('$9.99')).toBeInTheDocument();
    });

    it('si el servidor no publica la promocion ni Analitica, no se anuncian', async () => {
      getTarifas.mockResolvedValue({ success: true, data: { ...copia(), promo: null, analitica: null } });
      montar();

      expect(await screen.findByText('0.5%')).toBeInTheDocument();
      await screen.findAllByRole('columnheader');
      expect(screen.queryByText(/Comercios nuevos/)).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Analítica' })).toBeNull();
    });
  });

  describe('la honestidad de la pagina', () => {
    it('ya no ofrece Kiramo Negocio, Kiramo Cima ni su calculadora', async () => {
      montar();
      await screen.findAllByRole('columnheader');
      expect(screen.queryByText(/Negocio|Cima/)).toBeNull();
      expect(screen.queryByRole('slider')).toBeNull();
    });

    it('lo que no incluye lleva ocho limites con la misma letra que los beneficios', async () => {
      montar();

      const titulo = await screen.findByRole('heading', { name: 'Lo que no incluye ningún plan' });
      const lista = within(titulo.parentElement as HTMLElement).getAllByRole('listitem');
      expect(lista).toHaveLength(8);
      expect(screen.getByText('Mejor tipo de cambio')).toBeInTheDocument();
      expect(screen.getByText('Transferencias a cuentas de otros bancos')).toBeInTheDocument();
      expect(screen.getByText('Límites de tarjeta más altos')).toBeInTheDocument();
      expect(screen.getByText('Rendimiento o intereses sobre el dinero guardado')).toBeInTheDocument();

      // Mismo tamano, peso y color que la lista de lo que si trae.
      expect(screen.getByText('Tarjeta física').className).toBe(
        screen.getByText('Transferencias entre cuentas KiramoPay').className,
      );
    });

    it('comprar y vender cripto sale como igual en los tres planes, no como algo que no se incluye', async () => {
      // La app si deja comprar y vender cripto sin comision. Con la cruz de
      // "no incluido" una persona entendia que no podia operar.
      montar();

      const igual = await screen.findByRole('heading', { name: 'Igual en los tres, sin costo' });
      const incluidos = within(igual.parentElement as HTMLElement).getAllByRole('listitem');
      expect(incluidos.map((li) => li.textContent)).toContain('Comprar y vender cripto');

      const noIncluye = screen.getByRole('heading', { name: 'Lo que no incluye ningún plan' });
      const excluidos = within(noIncluye.parentElement as HTMLElement).getAllByRole('listitem');
      expect(excluidos.some((li) => /cripto/i.test(li.textContent ?? ''))).toBe(false);
    });

    it('no promete rendimiento ni porcentajes "hasta"', async () => {
      montar();
      await screen.findAllByRole('columnheader');
      expect(document.body.textContent).not.toMatch(/APY|hasta \d+(\.\d+)? ?%|mejor tipo de cambio garantizado/i);
    });

    it('avisa junto a los botones que todavia no se cobra nada', async () => {
      montar();
      expect(await screen.findAllByText(/Este botón no cobra nada ni te cambia de plan/)).toHaveLength(2);
    });
  });
});
