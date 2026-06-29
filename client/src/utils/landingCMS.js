import { CMS_DEFAULTS } from '@/data/landingData';

let _cachedSettings = null;
export async function getPlatformSettings() {
  if (_cachedSettings) return _cachedSettings;
  try {
    const res = await fetch('/api/platform/settings');
    if (res.ok) { _cachedSettings = await res.json(); return _cachedSettings; }
  } catch {}
  return {};
}

let _cachedCMS  = null;
let _cmsPromise = null;
export async function getLandingCMS() {
  if (_cachedCMS) return _cachedCMS;
  if (_cmsPromise) return _cmsPromise;
  _cmsPromise = fetch('/api/platform/landing-content')
    .then(r => r.ok ? r.json() : { data: null })
    .then(json => {
      const db = json?.data || {};
      _cachedCMS = {
        hero:       { ...CMS_DEFAULTS.hero,       ...(db.hero       || {}) },
        conviction: db.conviction?.length ? db.conviction : CMS_DEFAULTS.conviction,
        ecosystem:  { ...CMS_DEFAULTS.ecosystem,  ...(db.ecosystem  || {}) },
        showcase:   db.showcase?.length   ? db.showcase   : CMS_DEFAULTS.showcase,
        trust:      { ...CMS_DEFAULTS.trust,      ...(db.trust      || {}) },
        footer:     { ...CMS_DEFAULTS.footer,     ...(db.footer     || {}) },
        seo:        { ...CMS_DEFAULTS.seo,        ...(db.seo        || {}) },
      };
      return _cachedCMS;
    })
    .catch(() => { _cachedCMS = CMS_DEFAULTS; return CMS_DEFAULTS; });
  return _cmsPromise;
}
