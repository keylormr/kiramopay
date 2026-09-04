import { useEffect } from 'react';
import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

export interface DeepLinkHandler {
  navigateTo: (tab: string, params?: Record<string, string>) => void;
  isAuthenticated: boolean;
}

export interface ParsedDeepLink {
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

// Resolved deep-link targets travel over a tiny module-level bus rather than
// React props. The listener has to live above the auth gate (a link can arrive
// while the login screen is up), but only the authenticated shell owns the tab
// state — and the shell may not be mounted yet when the target resolves, so the
// last unconsumed target is replayed to whoever subscribes next.
let pendingTarget: ParsedDeepLink | null = null;
const subscribers = new Set<(target: ParsedDeepLink) => void>();

export function publishDeepLink(target: ParsedDeepLink) {
  if (subscribers.size === 0) {
    pendingTarget = target;
    return;
  }
  subscribers.forEach((fn) => fn(target));
}

export function subscribeDeepLink(fn: (target: ParsedDeepLink) => void): () => void {
  subscribers.add(fn);
  if (pendingTarget) {
    const target = pendingTarget;
    pendingTarget = null;
    fn(target);
  }
  return () => {
    subscribers.delete(fn);
  };
}

const PENDING_KEY = 'pending_deep_link';

// The launch URL belongs to the process, not to the effect: this hook re-runs
// whenever the session flips, and re-reading it there would route the user back
// to the launch screen every time — even after they had navigated away.
let launchUrlConsumed = false;

export function useDeepLinks(handler: DeepLinkHandler) {
  const { isAuthenticated, navigateTo } = handler;

  useEffect(() => {
    // A link that arrives while the user is logged out is parked until after
    // login instead of being dropped: tapping a payment link should still land
    // on the right screen once the session exists.
    const routeOrPark = (url: string) => {
      const parsed = parseDeepLink(url);
      if (!parsed) return;

      if (!isAuthenticated) {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(parsed));
        return;
      }

      navigateTo(parsed.tab, parsed.params);
    };

    // Replay whatever was parked before the session existed. Runs on web too:
    // nothing parks a link there, so this is simply a no-op.
    if (isAuthenticated) {
      const pending = sessionStorage.getItem(PENDING_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_KEY);
        try {
          const parsed = JSON.parse(pending) as ParsedDeepLink;
          navigateTo(parsed.tab, parsed.params);
        } catch {
          // Ignore invalid stored deep link
        }
      }
    }

    // The rest is native-only: on web there is no plugin to talk to.
    if (!Capacitor.isNativePlatform()) return;

    // Capacitor does NOT dispatch plugin events as window CustomEvents — the
    // URL arrives through the plugin bridge, so this must be an App listener.
    const listener = CapApp.addListener('appUrlOpen', ({ url }) => {
      routeOrPark(url);
    });

    // A cold start launched *by* a link may deliver the URL before the WebView
    // has a listener attached, so the launch URL is read separately — once.
    if (!launchUrlConsumed) {
      launchUrlConsumed = true;
      void CapApp.getLaunchUrl().then((launch) => {
        if (launch?.url) routeOrPark(launch.url);
      }).catch(() => {
        // No launch URL available — normal start, nothing to route.
      });
    }

    return () => {
      void listener.then((handle) => handle.remove());
    };
  }, [isAuthenticated, navigateTo]);
}

export { parseDeepLink };
