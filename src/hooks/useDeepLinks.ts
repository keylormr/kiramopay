import { useEffect } from 'react';

export interface DeepLinkHandler {
  navigateTo: (tab: string, params?: Record<string, string>) => void;
  isAuthenticated: boolean;
}

interface ParsedDeepLink {
  tab: string;
  params: Record<string, string>;
}

function parseDeepLink(url: string): ParsedDeepLink | null {
  try {
    // Handle kiramopay://pay?amount=5000
    // Handle https://app.kiramopay.com/pay?amount=5000
    // Handle https://app.kiramopay.com/transfer/123
    let path = '';
    let searchParams = new URLSearchParams();

    if (url.startsWith('kiramopay://')) {
      const afterScheme = url.replace('kiramopay://', '');
      const [pathPart, queryPart] = afterScheme.split('?');
      path = pathPart;
      if (queryPart) searchParams = new URLSearchParams(queryPart);
    } else {
      const parsed = new URL(url);
      path = parsed.pathname.replace(/^\//, '');
      searchParams = parsed.searchParams;
    }

    const params: Record<string, string> = {};
    searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // Map paths to tabs
    const segments = path.split('/').filter(Boolean);
    const route = segments[0] || '';

    switch (route) {
      case 'pay':
      case 'sinpe':
        return { tab: 'sinpe', params };
      case 'transfer':
        if (segments[1]) params.id = segments[1];
        return { tab: 'sinpe', params };
      case 'crypto':
        return { tab: 'crypto', params };
      case 'services':
        return { tab: 'services', params };
      case 'profile':
        return { tab: 'profile', params };
      case 'home':
      case '':
        return { tab: 'home', params };
      default:
        return null; // Unknown path, ignore silently
    }
  } catch {
    return null; // Invalid URL, ignore silently
  }
}

export function useDeepLinks(handler: DeepLinkHandler) {
  const { isAuthenticated, navigateTo } = handler;

  useEffect(() => {
    // Listen for Capacitor deep link events
    const handleAppUrlOpen = (event: CustomEvent<{ url: string }>) => {
      const parsed = parseDeepLink(event.detail.url);
      if (!parsed) return;

      if (!isAuthenticated) {
        // Store deep link for after login
        sessionStorage.setItem('pending_deep_link', JSON.stringify(parsed));
        return;
      }

      navigateTo(parsed.tab, parsed.params);
    };

    // Capacitor fires 'appUrlOpen' on the window
    window.addEventListener('appUrlOpen', handleAppUrlOpen as EventListener);

    // Check for pending deep link after auth
    if (isAuthenticated) {
      const pending = sessionStorage.getItem('pending_deep_link');
      if (pending) {
        sessionStorage.removeItem('pending_deep_link');
        try {
          const parsed = JSON.parse(pending) as ParsedDeepLink;
          navigateTo(parsed.tab, parsed.params);
        } catch {
          // Ignore invalid stored deep link
        }
      }
    }

    return () => {
      window.removeEventListener('appUrlOpen', handleAppUrlOpen as EventListener);
    };
  }, [isAuthenticated, navigateTo]);
}

export { parseDeepLink };
