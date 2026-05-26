import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../ErrorBoundary';

// A helper component that throws on demand
const ThrowingChild = ({ shouldThrow }: { shouldThrow: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test explosion');
  }
  return <div>All good</div>;
};

describe('ErrorBoundary', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('kiramopay_language', 'es');
  });

  // Suppress React error boundary console.error noise during tests
  const originalConsoleError = console.error;
  beforeAll(() => {
    console.error = (...args: unknown[]) => {
      const msg = typeof args[0] === 'string' ? args[0] : '';
      // Filter out React error boundary warnings that clutter test output
      if (
        msg.includes('Error: Uncaught') ||
        msg.includes('The above error occurred') ||
        msg.includes('act(') ||
        msg.includes('Error Boundary')
      ) {
        return;
      }
      originalConsoleError(...args);
    };
  });

  afterAll(() => {
    console.error = originalConsoleError;
  });

  it('should render children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Child content here</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Child content here')).toBeInTheDocument();
  });

  it('should catch errors and show error UI in Spanish', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    // Should show the Spanish error translations
    expect(screen.getByText('Algo salio mal')).toBeInTheDocument();
    expect(
      screen.getByText('Ocurrio un error inesperado. Puedes intentar de nuevo o volver al inicio.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Reintentar')).toBeInTheDocument();
    expect(screen.getByText('Inicio')).toBeInTheDocument();

    // Children should NOT be visible
    expect(screen.queryByText('All good')).not.toBeInTheDocument();
  });

  it('should show English error UI when language is set to en', () => {
    localStorage.setItem('kiramopay_language', 'en');

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
  });

  it('should fall back to Spanish when localStorage has invalid language', () => {
    localStorage.setItem('kiramopay_language', 'xx-invalid');

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Algo salio mal')).toBeInTheDocument();
  });

  it('should reset error state and re-render children when retry is clicked', async () => {
    const user = userEvent.setup();
    let shouldThrow = true;

    const ConditionalThrower = () => {
      if (shouldThrow) throw new Error('Boom');
      return <div>Recovered successfully</div>;
    };

    render(
      <ErrorBoundary>
        <ConditionalThrower />
      </ErrorBoundary>,
    );

    // Error UI should be visible
    expect(screen.getByText('Algo salio mal')).toBeInTheDocument();

    // Now stop throwing so that after retry, children render normally
    shouldThrow = false;

    // Click retry button
    await user.click(screen.getByText('Reintentar'));

    // After retry, children should render again
    expect(screen.getByText('Recovered successfully')).toBeInTheDocument();
    expect(screen.queryByText('Algo salio mal')).not.toBeInTheDocument();
  });

  it('should navigate to / when home button is clicked', async () => {
    const user = userEvent.setup();

    // Mock window.location.href setter
    const originalLocation = window.location;
    const mockLocation = { ...originalLocation, href: '' };
    Object.defineProperty(window, 'location', {
      writable: true,
      value: mockLocation,
    });

    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    await user.click(screen.getByText('Inicio'));
    expect(mockLocation.href).toBe('/');

    // Restore original location
    Object.defineProperty(window, 'location', {
      writable: true,
      value: originalLocation,
    });
  });

  it('should show error details in DEV mode', () => {
    // import.meta.env.DEV is true in Vitest by default
    render(
      <ErrorBoundary>
        <ThrowingChild shouldThrow={true} />
      </ErrorBoundary>,
    );

    // The error message should be visible in a <pre> block
    expect(screen.getByText(/Test explosion/)).toBeInTheDocument();
  });
});
