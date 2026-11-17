// Minimal RFC-4180 CSV parser/writer (quotes, escaped quotes, CRLF, BOM).
export function parseCsv(text) {
  const rows = []; let row = [], cell = '', inQ = false;
  text = String(text).replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false; } else cell += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
// Prefix cells that spreadsheets would execute as formulas (CSV injection).
const safe = (v) => { const s = String(v ?? ''); return /^[=+\-@\t\r]/.test(s) && isNaN(Number(s)) ? "'" + s : s; };
export const toCsv = (rows) => rows.map((r) => r.map((v) => { const s = safe(v); return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }).join(',')).join('\r\n') + '\r\n';
