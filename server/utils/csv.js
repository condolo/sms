/* ============================================================
   Shared CSV parsing — extracted from routes/import-export.js so other
   importers (e.g. the lesson-plan CSV import) can reuse the same
   quoted-comma-aware parser as a plain utility, without pulling in the
   whole import-export router (and its real middleware/DB wiring) just to
   get a string-parsing function.
   ============================================================ */
'use strict';

function _parseCSVLine(line) {
  const fields = [];
  let field    = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(field);
      field = '';
    } else {
      field += ch;
    }
  }
  fields.push(field);
  return fields;
}

/**
 * Parse CSV text → array of objects (first row = headers).
 * Returns { headers, rows, error? }
 */
function parseCSV(text) {
  const raw = (text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const nonEmpty = raw.filter(l => l.trim());
  if (nonEmpty.length < 2) return { headers: [], rows: [], error: 'CSV must have a header row and at least one data row' };

  const headers = _parseCSVLine(nonEmpty[0]).map(h => h.trim());
  const rows    = [];

  for (let i = 1; i < nonEmpty.length; i++) {
    const values = _parseCSVLine(nonEmpty[i]);
    const row    = {};
    headers.forEach((h, idx) => {
      row[h] = (values[idx] !== undefined ? values[idx] : '').trim();
    });
    rows.push(row);
  }
  return { headers, rows };
}

module.exports = { parseCSV, _parseCSVLine };
