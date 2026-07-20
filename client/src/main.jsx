import React from 'react';
import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { HelmetProvider } from 'react-helmet-async';

import { router } from './App.jsx';
import ErrorBoundary from '@/components/guards/ErrorBoundary.jsx';
import FloatingWidgets from '@/components/FloatingWidgets.jsx';
import CookieConsentBanner from '@/components/CookieConsentBanner.jsx';
import { initAnalyticsIfConsented } from '@/utils/analytics.js';

// Loads GA immediately only if a prior visit already accepted the cookie
// banner — otherwise this is a no-op and GA never loads at all. See
// CookieConsentBanner.jsx / utils/analytics.js.
initAnalyticsIfConsented();

// Fire a GA4 page_view on every client-side navigation. window.gtag only
// exists once analytics.js has actually loaded GA (post-consent), so this
// silently no-ops for a visitor who hasn't accepted (or has declined).
// The first call is skipped because analytics.js's own gtag('config', ...)
// already fires the initial page_view when GA first loads.
let _gaInitialSkipped = false;
router.subscribe((state) => {
  if (!_gaInitialSkipped) { _gaInitialSkipped = true; return; }
  if (typeof window.gtag === 'function') {
    window.gtag('event', 'page_view', {
      page_path:     state.location.pathname + state.location.search,
      page_location: window.location.href,
      page_title:    document.title,
    });
  }
});
import './index.css';

// Auto-reload when a lazy chunk 404s after a new deploy.
// Covers two cases:
//   1. vite:preloadError — Vite's <link rel="modulepreload"> hint fails
//   2. unhandledrejection — dynamic import() promise rejects (React Router lazy routes)
window.addEventListener('vite:preloadError', () => window.location.reload());

window.addEventListener('unhandledrejection', (event) => {
  const msg = event?.reason?.message || '';
  if (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('Importing a module script failed') ||
    msg.includes('error loading dynamically imported module')
  ) {
    event.preventDefault();
    window.location.reload();
  }
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime:          2 * 60 * 1000,   // 2 minutes — matches server TTL cache
      gcTime:             5 * 60 * 1000,   // 5 minutes GC
      retry:              1,
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 0,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <HelmetProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <FloatingWidgets />
          <CookieConsentBanner />
          {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
        </QueryClientProvider>
      </ErrorBoundary>
    </HelmetProvider>
  </React.StrictMode>,
);
