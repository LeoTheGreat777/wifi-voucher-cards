// Reads the text out of a PDF in the browser (nothing is uploaded anywhere).
import * as pdfjs from '../vendor/pdfjs/pdf.min.mjs';

pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

/**
 * Returns the PDF's text in two orders, because PDFs differ:
 *  - `stream`: the order things were drawn. Keeps each card together on
 *    multi-column sheets.
 *  - `lines`: top-to-bottom, left-to-right. Needed for PDFs (like FortiGate's
 *    browser printout) that draw all the labels first and all the values after.
 * The caller parses both and keeps whichever finds more vouchers.
 */
export async function pdfToText(data) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false }).promise;
  let stream = '';
  let lines = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const items = content.items.filter((it) => 'str' in it && it.str.trim());

    // Drawing order
    let lastY = null;
    for (const it of items) {
      const y = it.transform[5];
      if (lastY !== null && Math.abs(y - lastY) > 1.5) stream += '\n';
      else if (stream && !/\s$/.test(stream)) stream += ' ';
      stream += it.str.trim();
      lastY = y;
    }
    stream += '\n';

    // Reading order: group items into rows by their baseline.
    const sorted = items
      .map((it) => ({ x: it.transform[4], y: it.transform[5], h: Math.abs(it.transform[3]) || it.height || 10, s: it.str.trim() }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const rows = [];
    for (const it of sorted) {
      const row = rows[rows.length - 1];
      if (row && Math.abs(row.y - it.y) <= Math.max(2, 0.35 * Math.min(row.h, it.h))) row.items.push(it);
      else rows.push({ y: it.y, h: it.h, items: [it] });
    }
    for (const row of rows) lines += row.items.sort((a, b) => a.x - b.x).map((i) => i.s).join(' ') + '\n';
    lines += '\n';
  }
  await doc.destroy();
  return { stream, lines };
}
