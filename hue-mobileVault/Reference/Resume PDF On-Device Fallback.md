# Resume PDF On-Device Fallback (No-Anthropic)

Worked 2026-06-19. Follow-up to [[Resume PDF Cross-Provider + Latency Pass]]. User report: still
hitting *"PDF résumés are read natively by Anthropic…"* and wanted PDF upload to work **without an
Anthropic key at all**. They run Groq and explicitly accepted that on-device extraction is
imperfect — *"even if it's not accurate I just need to double check it."*

## Decision — restore the on-device PDF text path as the no-Anthropic fallback
Groq/Mistral/Cohere can't read a PDF (OpenAI chat-completions has no PDF part), and a local Gemma
on the user's phone has no HTTP endpoint we can reach + is text-only, so neither solves PDF
*reading*. The only provider-agnostic option is on-device text extraction — exactly the pdf.js
(`unpdf`) path removed in [[Latency Caching and Test Infra Pass]] for garbling. Re-added it as a
**fallback**, by explicit user choice to trade accuracy for not needing an Anthropic key.

PDF branch in `lib/resume.ts` now forks on `anthropicApiKey`:
- **Anthropic key set** → unchanged accurate native read (`cleanResumeFromPdf`, `forceAnthropic`).
- **No Anthropic key** → `extractPdfTextOnDevice()` (lazy `import('./pdfExtractor')` so pdf.js only
  loads when a PDF is picked without a key) → cleaned through the **configured provider** (Groq)
  via the shared `parseFromExtractedText()` tail — same raw-text fallback as DOCX/TXT. Only a PDF
  that yields *no* text asks for a DOCX/TXT export.

## Restored plumbing (was deleted last commit)
- `lib/pdfExtractor.ts` + `lib/pdfPolyfills.ts` — the Hermes-tuned unpdf wrapper + global shims.
- `babel.config.js` — `import.meta` neutralizer (jest unaffected: `jest.config.js` pins
  `configFile:false`/`babelrc:false`).
- `metro.config.js` — the `unpdf` / `unpdf/pdfjs` resolution alias (see [[Metro unpdf Resolution Fix]]).
- deps: `unpdf@^1.6.2`, `@babel/plugin-syntax-import-meta@^7.10.4`.

## The accuracy caveat (kept honest in the UI)
Under Hermes pdf.js has no CMap/standard-font data, so PDFs with subsetted fonts + no ToUnicode map
extract garbled text, and the cleanup LLM may "correct" garbage into a *plausible-but-wrong* name.
The Settings résumé hint + the existing "give it a quick read" nudge both flag this. Accurate route
remains a DOCX/TXT export or an Anthropic key.

Touched: `lib/resume.ts`, `app/settings.tsx` (hint + doc copy), `lib/pdfExtractor.ts`,
`lib/pdfPolyfills.ts`, `babel.config.js`, `metro.config.js`, `package.json`.

## Status
`tsc --noEmit` clean · 23/23 jest tests pass · `expo export --platform android` bundles clean
(1594 modules, back up from 1585; Hermes `.hbc` built).
