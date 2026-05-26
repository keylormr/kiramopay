import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageProvider } from '@/i18n/LanguageContext';
import { BottomSheet } from '../BottomSheet';

const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <LanguageProvider>{children}</LanguageProvider>
);

describe('BottomSheet', () => {
  beforeEach(() => {
    localStorage.setItem('kiramopay_language', 'es');
  });

  it('should not render when closed', () => {
    render(
      <BottomSheet isOpen={false} onClose={() => {}}>
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(screen.queryByText('Content')).not.toBeInTheDocument();
  });

  it('should render children when open', () => {
    render(
      <BottomSheet isOpen={true} onClose={() => {}}>
        <p>Sheet Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('Sheet Content')).toBeInTheDocument();
  });

  it('should render title when provided', () => {
    render(
      <BottomSheet isOpen={true} onClose={() => {}} title="My Title">
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(screen.getByText('My Title')).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <BottomSheet isOpen={true} onClose={onClose} title="Test">
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    await user.click(screen.getByLabelText(/cerrar/i));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should call onClose when backdrop is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(
      <BottomSheet isOpen={true} onClose={onClose}>
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    // The backdrop is rendered as a portal at document.body level
    // Click the backdrop (the first positioned div in the portal)
    const backdrop = document.querySelector('[style*="backdrop-filter"]');
    expect(backdrop).toBeTruthy();
    await user.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('should set body overflow to hidden when open', () => {
    render(
      <BottomSheet isOpen={true} onClose={() => {}}>
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('should restore body overflow when closed', async () => {
    const { rerender } = render(
      <BottomSheet isOpen={true} onClose={() => {}}>
        <p>Content</p>
      </BottomSheet>,
      { wrapper: Wrapper },
    );
    expect(document.body.style.overflow).toBe('hidden');

    rerender(
      <LanguageProvider>
        <BottomSheet isOpen={false} onClose={() => {}}>
          <p>Content</p>
        </BottomSheet>
      </LanguageProvider>,
    );
    expect(document.body.style.overflow).toBe('');
  });
});
