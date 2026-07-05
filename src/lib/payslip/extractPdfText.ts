import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// Vite bundles the pdf.js worker as a Web Worker chunk. This whole module is
// itself lazy-imported by PayslipImportModal, so pdf.js and its worker only
// load when the user actually opens the importer — they stay out of the main
// bundle.
import PdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';

pdfjs.GlobalWorkerOptions.workerPort = new PdfjsWorker();

/** Group a page's text items into visual lines (top-to-bottom, left-to-right). */
async function pageLines(page: PDFPageProxy): Promise<string[]> {
  const content = await page.getTextContent();
  const rows = new Map<number, { x: number; str: string }[]>();
  for (const item of content.items) {
    if (!('str' in item)) continue;
    const y = Math.round(item.transform[5]);
    const x = item.transform[4];
    const row = rows.get(y) ?? [];
    row.push({ x, str: item.str });
    rows.set(y, row);
  }
  const lines: string[] = [];
  for (const y of [...rows.keys()].sort((a, b) => b - a)) {
    const line = rows
      .get(y)!
      .sort((a, b) => a.x - b.x)
      .map(r => r.str)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (line) lines.push(line);
  }
  return lines;
}

/** Render a loaded page to a PNG data URL. `scale` 2 gives a crisp preview. */
async function renderPage(page: PDFPageProxy, scale: number): Promise<string> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';
  await page.render({ canvasContext: ctx, viewport }).promise;
  return canvas.toDataURL('image/png');
}

async function open(file: File): Promise<PDFDocumentProxy> {
  const data = new Uint8Array(await file.arrayBuffer());
  return pdfjs.getDocument({ data }).promise;
}

/**
 * Extract the text of every page. A payslip archive holds one payslip per page,
 * so the caller parses each page's lines independently. The File is never
 * uploaded or persisted — bytes live only in memory for this call.
 */
export async function extractPayslipPages(file: File): Promise<string[][]> {
  const doc = await open(file);
  try {
    const pages: string[][] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      pages.push(await pageLines(page));
      page.cleanup();
    }
    return pages;
  } finally {
    await doc.destroy();
  }
}

/**
 * Render a single page (0-indexed) to a PNG data URL, on demand — used for the
 * validation preview so we don't rasterise a 30-page archive up front.
 */
export async function renderPdfPage(file: File, pageIndex: number, scale = 2): Promise<string> {
  const doc = await open(file);
  try {
    const page = await doc.getPage(pageIndex + 1);
    const url = await renderPage(page, scale);
    page.cleanup();
    return url;
  } finally {
    await doc.destroy();
  }
}
