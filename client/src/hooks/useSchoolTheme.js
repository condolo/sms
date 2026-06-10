/**
 * useSchoolTheme — Dynamic colour palette derived from a school's
 * primaryColor + accentColor settings.
 *
 * Every module KPI card and the main dashboard tiles read colours
 * from this hook so each tenant's dashboard matches their brand.
 *
 * Usage:
 *   const { palette, tint, primary, accent } = useSchoolTheme();
 *
 *   palette[0]  → { bg: '#4f46e5', text: '#ffffff' }  ← filled card
 *   tint(1)     → { iconBg: 'rgba(…)', iconColor: '…' } ← tinted card
 */
import useAuthStore from '@/store/auth.js';

/* ── Colour-math helpers ────────────────────────────────────────── */

function hexToRgb(hex) {
  const h = (hex ?? '').replace('#', '');
  const s = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
  if (s.length !== 6) return { r: 79, g: 70, b: 229 }; // fallback indigo
  return {
    r: parseInt(s.slice(0, 2), 16),
    g: parseInt(s.slice(2, 4), 16),
    b: parseInt(s.slice(4, 6), 16),
  };
}

function toLinear(c) {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

function luminance({ r, g, b }) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/**
 * Returns '#ffffff' or '#1e293b' (slate-800) so text is always
 * legible — whichever gives the higher WCAG contrast ratio.
 */
export function contrastText(hex) {
  try {
    return luminance(hexToRgb(hex)) > 0.35 ? '#1e293b' : '#ffffff';
  } catch {
    return '#ffffff';
  }
}

/**
 * Darken a hex colour by pct percent (0–100).
 * darken('#4f46e5', 15) → slightly deeper indigo
 */
export function darken(hex, pct) {
  try {
    const { r, g, b } = hexToRgb(hex);
    const f = 1 - pct / 100;
    const d = c => Math.max(0, Math.round(c * f)).toString(16).padStart(2, '0');
    return `#${d(r)}${d(g)}${d(b)}`;
  } catch {
    return hex;
  }
}

/** Returns a CSS rgba() string */
export function withOpacity(hex, opacity) {
  try {
    const { r, g, b } = hexToRgb(hex);
    return `rgba(${r},${g},${b},${opacity})`;
  } catch {
    return `rgba(79,70,229,${opacity})`;
  }
}

/* ── Hook ───────────────────────────────────────────────────────── */

/**
 * useSchoolTheme()
 *
 * Returns:
 *   primary   — school primary colour hex (e.g. '#4f46e5')
 *   accent    — school accent colour hex  (e.g. '#7c3aed')
 *
 *   palette   — array of 4 filled-card entries:
 *               [{ bg: string, text: '#fff'|'#1e293b' }]
 *               Use palette[colorIndex % 4] on filled KPI cards.
 *
 *   tint(idx) — returns { iconBg, iconColor } for tinted mini-cards.
 *               idx 0 → primary, idx 1 → accent, cycles.
 */
export function useSchoolTheme() {
  const school  = useAuthStore(s => s.session?.school);
  const primary = school?.primaryColor ?? '#4f46e5';
  const accent  = school?.accentColor  ?? '#7c3aed';

  // Two darkened variants for visual depth on the 4-card dashboard row
  const p2 = darken(primary, 16);
  const a2 = darken(accent,  16);

  const palette = [
    { bg: primary, text: contrastText(primary) },
    { bg: accent,  text: contrastText(accent)  },
    { bg: p2,      text: contrastText(p2)      },
    { bg: a2,      text: contrastText(a2)      },
  ];

  /**
   * tint(idx) — icon background + icon colour for white-bg module cards.
   * Uses a 12% opacity tint of the school colour so it looks elegant
   * even on white without painting the whole card.
   */
  function tint(idx = 0) {
    const base = idx % 2 === 0 ? primary : accent;
    return {
      iconBg:    withOpacity(base, 0.12),
      iconColor: base,
    };
  }

  return { primary, accent, palette, tint };
}
