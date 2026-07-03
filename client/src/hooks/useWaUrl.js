import { useState, useEffect } from 'react';
import { getPlatformSettings } from '@/utils/landingCMS';
import { WA_NUMBER, WA_MESSAGE } from '@/data/landingData';

/**
 * Returns the WhatsApp URL built from the contactPhone stored in Platform Admin
 * (Branding & Settings → WhatsApp / Support Phone).
 * Falls back to the value in landingData.js if settings haven't been saved yet.
 */
export function useWaUrl() {
  const [waUrl, setWaUrl] = useState(`https://wa.me/${WA_NUMBER}?text=${WA_MESSAGE}`);

  useEffect(() => {
    getPlatformSettings().then(settings => {
      const raw = (settings?.contactPhone || '').replace(/\D/g, '');
      if (raw) setWaUrl(`https://wa.me/${raw}?text=${WA_MESSAGE}`);
    }).catch(() => {});
  }, []);

  return waUrl;
}
