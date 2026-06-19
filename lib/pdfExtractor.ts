// On-device PDF text extraction, isolated behind a SINGLE dynamic-import boundary.
//
// Why this module exists: unpdf's main entry lazily runs `import('unpdf/pdfjs')` to pull in
// its 1.6 MB serverless pdf.js build. Under Metro on native that nested (second-level)
// dynamic import is emitted as a split chunk that never registers in the runtime module
// map — so `modules.get(id)` is undefined and metroImportAll throws
// "cannot set property importedAll of undefined" (earlier it surfaced as
// "Requiring unknown module <n>"). The first-level `import()` works fine; only the nested
// one fails.
//
// Fix: import both `unpdf` AND `unpdf/pdfjs` STATICALLY here, then hand pdf.js to unpdf via
// configureUnPDF. Static imports ride in THIS module's chunk, so when lib/resume.ts lazily
// `import('./pdfExtractor')`s us, pdf.js comes along in that same (working) first-level
// chunk and unpdf resolves it synchronously — it never runs its own nested import().
//
// pdfPolyfills must be installed before pdf.js evaluates; the import order below guarantees
// it (ES imports evaluate top-to-bottom, and unpdf/pdfjs is the heavy one).
//
// Accuracy caveat: under Hermes the bundled pdf.js has no standard-font/CMap data (unpdf
// only wires those up under Node), so glyph→Unicode mapping is guessed for PDFs that embed
// subsetted fonts without a ToUnicode map — names and other text can come out garbled. This
// is the no-Anthropic-key fallback only; the accurate path is the native Anthropic read in
// lib/resume.ts. Callers must surface a "verify this" nudge for the extracted result.
import './pdfPolyfills'

import { configureUnPDF, extractText as extractPdf, getDocumentProxy } from 'unpdf'
import * as pdfjs from 'unpdf/pdfjs'

// Configure once. unpdf calls our resolver instead of its internal import('unpdf/pdfjs');
// its own interopDefault handles the namespace (pdfjs.mjs has named exports, no default).
let configured: Promise<void> | undefined
function ensureConfigured(): Promise<void> {
  if (!configured) configured = configureUnPDF({ pdfjs: () => Promise.resolve(pdfjs) })
  return configured
}

/** Extract and merge all page text from an in-memory PDF. Runs on the JS thread (FakeWorker). */
export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  await ensureConfigured()
  const pdf = await getDocumentProxy(bytes)
  const { text } = await extractPdf(pdf, { mergePages: true })
  return Array.isArray(text) ? text.join('\n') : text
}
