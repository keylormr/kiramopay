import { render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { precargarIdioma } from '@/test/idiomas';
import { fechaYHora } from '@/utils/fechaPlazo';
import { NotificationsView } from '../NotificationsView';
import type { Notification } from '@/types';

// La fecha de una notificacion llegaba ya escrita en es-CR (d/m/aaaa): el
// adaptador la armaba con toLocaleDateString('es-CR') y el aviso en vivo la
// traia armada del servidor. En ingles, "4/9/2026" se lee 9 de abril.

const estado = vi.hoisted(() => ({ notifications: [] as Notification[] }));

vi.mock('@/hooks/useApp', () => ({ useApp: () => ({ state: estado, dispatch: vi.fn() }) }));

const ISO = '2026-09-04T15:30:00Z';

function pintar() {
  return render(
    <LanguageProvider>
      <NotificationsView onClose={() => {}} />
    </LanguageProvider>,
  );
}

beforeAll(() => precargarIdioma('en'));

beforeEach(() => {
  localStorage.clear();
});

describe('NotificationsView — la fecha en el idioma de la pantalla', () => {
  it('en ingles, la fecha sale en formato ingles y no en el d/m de es-CR', async () => {
    localStorage.setItem('kiramopay_language', 'en');
    const conFecha = {
      id: 'n1', title: 'SINPE received', message: 'You received 5,000 colones',
      type: 'transaction', date: '4/9/2026', dateISO: ISO, read: false,
    };
    estado.notifications = [conFecha as Notification];

    pintar();

    expect(await screen.findByText(fechaYHora(ISO, 'en'))).toBeInTheDocument();
    expect(screen.queryByText('4/9/2026')).not.toBeInTheDocument();
  });

  it('una notificacion sin fecha de maquina (guardada por una version anterior) muestra la que trae', async () => {
    localStorage.setItem('kiramopay_language', 'es');
    estado.notifications = [{
      id: 'n2', title: 'Aviso', message: 'Texto', type: 'info', date: 'Hoy, 10:00 AM', read: true,
    }];

    pintar();

    expect(await screen.findByText('Hoy, 10:00 AM')).toBeInTheDocument();
  });
});
