/* ============================================================
   resizeImageToDataUrl — 2026-09

   Same technique already used independently in StudentProfile.jsx and
   SettingsPage.jsx (student/staff photos, school logo) for turning a
   picked file into a small base64 JPEG before it's stored directly on
   the document — this app has no separate file-storage service, so
   keeping the encoded image small is what keeps documents small.
   Extracted here for the two NEW upload sites this shares (Inventory
   item photos, Library book covers) so they don't each hand-roll their
   own copy — the older two call sites are left as they are; only new
   code was made to share this.
   ============================================================ */

/**
 * Read `file`, downscale to fit within maxW x maxH (never upscales),
 * and resolve to a JPEG data URI at the given quality.
 */
export function resizeImageToDataUrl(file, { maxW = 400, maxH = 400, quality = 0.85 } = {}) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read file'));
    reader.onload = e => {
      const img = new Image();
      img.onerror = () => reject(new Error('Image failed to load'));
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }
        if (h > maxH) { w = Math.round(w * maxH / h); h = maxH; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}
