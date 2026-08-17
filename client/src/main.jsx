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
import { detectSchool } from '@/utils/schoolDetect.js';

// Marketing analytics (GA) and its consent banner belong to the public
// marketing site, not a school's own portal — a school subdomain is a
// distinct application, not "part of the landing page" with tracking
// along for the ride. Both are gated on the same synchronous host check
// App.jsx's router already uses.
const { isSchool } = detectSchool();

// Loads GA immediately only if a prior visit already accepted the cookie
// banner — otherwise this is a no-op and GA never loads at all. See
// CookieConsentBanner.jsx / utils/analytics.js. Never runs on a school
// portal at all.
if (!isSchool) initAnalyticsIfConsented();

// Fire a GA4 page_view on every client-side navigation. window.gtag only
// exists once analytics.js has actually loaded GA (post-consent), so this
// silently no-ops for a visitor who hasn't accepted (or has declined).
// The first call is skipped because analytics.js's own gtag('config', ...)
// already fires the initial page_view when GA first loads.
let _gaInitialSkipped = false;
router.subscribe((state) => {
  if (isSchool) return;
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
      // Retry once, but NEVER for a 4xx — those are never going to succeed
      // on an immediate retry (bad request, forbidden, not found), and for
      // 429 specifically a blind retry actively makes things worse: it
      // fires a second request into an already-exhausted rate-limit
      // window, which counts against the SAME budget and is virtually
      // guaranteed to 429 again — every one of a page's 8-10 parallel
      // queries auto-doubling the moment the limit trips. This is what
      // made a rate-limit hit feel "stuck" rather than a one-off blip.
      // Reserve the retry for what it's actually for: a transient network
      // blip or a 5xx.
      retry: (failureCount, error) => {
        const status = error?.status;
        if (typeof status === 'number' && status >= 400 && status < 500) return false;
        return failureCount < 1;
      },
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
          {!isSchool && <CookieConsentBanner />}
          {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
        </QueryClientProvider>
      </ErrorBoundary>
    </HelmetProvider>
  </React.StrictMode>,
);
