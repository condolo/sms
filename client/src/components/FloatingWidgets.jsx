import { useState, useEffect } from 'react';
import { getPlatformSettings } from '@/utils/landingCMS';
import useAuthStore from '@/store/auth';

const WA_MESSAGE = encodeURIComponent('Hello Msingi, I would like to learn more about the platform.');
const SCROLL_THRESHOLD = 300;

export default function FloatingWidgets() {
  // Hide on any authenticated school/portal dashboard — widget is for marketing only
  const isAuthenticated = useAuthStore(s => !!s.session?.user);
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [waUrl, setWaUrl] = useState(null);

  useEffect(() => {
    // Load WhatsApp number from platform settings (editable in Platform Admin → Branding)
    getPlatformSettings().then(settings => {
      const raw = (settings?.contactPhone || '').replace(/\D/g, '');
      if (raw) setWaUrl(`https://wa.me/${raw}?text=${WA_MESSAGE}`);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    function onScroll() {
      setShowScrollTop(window.scrollY > SCROLL_THRESHOLD);
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Early return after all hooks — authenticated users are in the school dashboard
  if (isAuthenticated) return null;

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-center gap-3">
      {/* Scroll-to-top — only visible after scrolling down */}
      <button
        onClick={scrollToTop}
        aria-label="Scroll to top"
        className={[
          'flex items-center justify-center w-11 h-11 rounded-full shadow-lg',
          'bg-white border border-slate-200 text-slate-600',
          'hover:bg-slate-50 hover:text-indigo-600 hover:border-indigo-300',
          'transition-all duration-200',
          showScrollTop
            ? 'opacity-100 translate-y-0 pointer-events-auto'
            : 'opacity-0 translate-y-4 pointer-events-none',
        ].join(' ')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className="w-5 h-5"
        >
          <path d="M12 19V5M5 12l7-7 7 7" />
        </svg>
      </button>

      {/* WhatsApp button — only shown once number is loaded from settings */}
      {waUrl && (
        <a
          href={waUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Chat with us on WhatsApp"
          className={[
            'flex items-center justify-center rounded-full shadow-lg',
            'bg-[#25D366] hover:bg-[#20b858]',
            'transition-colors duration-200',
          ].join(' ')}
          style={{ width: '52px', height: '52px' }}
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className="w-7 h-7">
            <path
              fill="#fff"
              d="M16 2C8.268 2 2 8.268 2 16c0 2.444.658 4.733 1.807 6.706L2 30l7.52-1.775A13.93 13.93 0 0 0 16 30c7.732 0 14-6.268 14-14S23.732 2 16 2Zm0 25.6a11.56 11.56 0 0 1-5.896-1.61l-.422-.25-4.464 1.053 1.082-4.33-.275-.444A11.56 11.56 0 0 1 4.4 16C4.4 9.593 9.593 4.4 16 4.4S27.6 9.593 27.6 16 22.407 27.6 16 27.6Zm6.34-8.664c-.347-.174-2.056-1.015-2.375-1.13-.32-.117-.552-.175-.784.174-.232.348-.899 1.13-1.102 1.362-.203.232-.406.26-.753.087-.348-.175-1.468-.54-2.795-1.724-1.033-.92-1.73-2.056-1.933-2.404-.203-.347-.022-.535.152-.708.157-.156.348-.406.522-.609.174-.203.232-.348.348-.58.116-.232.058-.435-.029-.609-.087-.174-.784-1.89-1.074-2.588-.283-.68-.57-.587-.784-.598-.203-.01-.435-.013-.667-.013s-.609.087-.928.435c-.319.348-1.218 1.19-1.218 2.9s1.247 3.365 1.42 3.597c.174.232 2.454 3.748 5.948 5.253.832.358 1.481.572 1.987.732.835.265 1.595.228 2.196.138.67-.1 2.056-.84 2.347-1.652.29-.812.29-1.508.203-1.653-.087-.144-.319-.232-.667-.406Z"
            />
          </svg>
        </a>
      )}
    </div>
  );
}
