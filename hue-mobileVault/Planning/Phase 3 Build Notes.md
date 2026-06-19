# Phase 3 Build Notes

Status log for [[Phased Roadmap|Phase 3 — Vision + resume]]. The **resume** half built
2026-06-18; vision (camera/image → vision LLM) is still to come.

## What shipped (resume upload + grounding + human voice)
The user can now **upload a resume**, Hue **grounds answers in it and never fabricates**, there's
a **second free-text context field**, and answers are tuned to **sound more human**.

- **`lib/resume.ts` (new) — on-device extract → LLM cleanup.** Mirrors desktop's
  `resume.ts` + `resumeCleanup.ts`. `pickAndParseResume(settings)`:
  1. `expo-document-picker` picks a PDF / DOCX / TXT (`copyToCacheDirectory` so we can read it).
  2. Extract text **on-device** (the file itself never leaves the phone):
     - **TXT** → `new File(uri).text()` (expo-file-system v56 File/Blob API).
     - **DOCX** → `new Uint8Array(await file.arrayBuffer())` → `fflate.unzipSync` → strip
       `word/document.xml` markup (tabs/breaks/`</w:p>` → text, decode XML entities). Pure JS,
       Hermes-safe.
     - **PDF** → serverless **pdf.js via `unpdf`** (`extractText`, `mergePages`), lazy-imported.
       Runs on the JS thread (pdf.js "FakeWorker"). See the Hermes plumbing below.
  3. Run the extracted text through the configured LLM once (`CLEANUP_SYSTEM`, ported verbatim
     from desktop — "NEVER invent, embellish, or guess") via a `completeOnce` helper that wraps
     the existing streaming clients and accumulates deltas. Result → `resumeSummary` (still editable).
  - Graceful fallback: if cleanup fails (e.g. no API key), we save the **raw** extracted text and
    flag `raw: true` so the UI says so. Scanned/image PDFs (no text) get a clear "paste it instead"
    error. Caps: 24k chars to the LLM, 6k persisted.

- **Prompt grounding — anti-fabrication (`lib/prompts.ts`).** The companion prompt's "never invent"
  rule is now much stronger and explicit per the user's ask: the resume + extra context are the
  **only source of truth**; **never** claim an employer/project/client/school/date/tool/metric that
  isn't there ("inventing a fake company or a project they never did is the worst failure here — it
  gets the user caught"). When the background doesn't cover a question, answer with honest general
  reasoning or a fillable `[placeholder]` — never a fabricated specific. Same source-of-truth framing
  added to the interviewer prompt.

- **New `additionalContext` setting.** Free-text field after the resume (`HueSettings`,
  `DEFAULT_SETTINGS`, both prompts, Settings UI). Treated as equally true as the resume.

- **Human voice (`HUMAN_VOICE_GUIDANCE`).** Extended with more of the **blader/humanizer** rule set
  (the "human skill"): negative parallelisms ("not just X, it's Y"), false ranges ("from X to Y"),
  synonym cycling, significance inflation, manufactured staccato punchlines, fake-candid rhetorical
  openers. ⚠️ **This now DIVERGES from desktop's copy** — desktop's `HUMAN_VOICE_GUIDANCE` should be
  synced to match (see [[Open Questions]]).

- **Settings UI (`app/(tabs)/settings.tsx`).** New "Upload resume (PDF, DOCX, TXT)" button with
  busy/success/error states under the Interview section, above the (still editable) Resume summary
  box, followed by the new Additional context field.

## ⚠️ Windows/pnpm/Hermes plumbing for on-device PDF (unpdf) — required, non-obvious
On-device PDF parsing (the user's explicit choice over LLM-native or DOCX/TXT-only) needed pdf.js to
run under Hermes. Three things, all required:

1. **`lib/pdfPolyfills.ts`** — shims the globals Hermes lacks but pdf.js expects:
   `Promise.withResolvers`, `structuredClone`, `atob`/`btoa`, a `ReadableStream` stub. Guarded by
   `typeof` checks; imported before unpdf. (unpdf polyfills `DOMMatrix` itself.)
2. **`babel.config.js` (new)** — neutralizes `import.meta`. pdf.js references `import.meta.url`;
   Hermes has no `import.meta` and Metro won't transform it, so the bundle wouldn't compile. An inline
   Babel plugin rewrites every `import.meta` → `({ url: "" })`. pdf.js's FakeWorker handles the rest;
   the `import.meta.resolve` path is `isNode`-guarded (false on device).
3. **pnpm dep resolution** — adding a user `babel.config.js` meant Babel had to resolve its own
   preset/plugins, which the relocated pnpm store (`C:\.pn`, see [[Phase 1 Build Notes]]) breaks.
   Fixes: `@babel/plugin-syntax-import-meta` is `require()`d (not referenced by name), and
   **`babel-preset-expo@56.0.15` had to be added as an explicit devDependency** (it's only a nested
   transitive of `expo`, so a by-name preset reference couldn't find it).

**Verified the JS bundle builds**: `expo export --platform android` → 1594 modules compiled to Hermes
bytecode (`.hbc`), which only succeeds if `import.meta` is gone. unpdf is in the bundle.

4. **Metro can't resolve `unpdf` under pnpm (found on-device 2026-06-18).** The dev server
   bundle (unlike `expo export`) resolved unpdf's `"exports"` `.` entry to an extensionless
   `dist/index` through the `C:\.pn` store symlink and failed → "Unable to resolve module" red
   box on resume pick. Fixed in `metro.config.js` by aliasing `unpdf` → `dist/index.cjs` and
   `unpdf/pdfjs` → `dist/pdfjs.mjs` via `resolver.resolveRequest`. Full writeup:
   [[Metro unpdf Resolution Fix]].

## ⚠️ Unverified on real hardware from this session
New native modules (document-picker, file-system) → needs the `pnpm expo run:android` rebuild that's
in flight. **Update 2026-06-18:** the dev build runs and the resume-pick path now *bundles* after the
[[Metro unpdf Resolution Fix]]; the on-device pass below (esp. whether pdf.js actually extracts text)
is still pending. On-device pass to run:
1. Settings → **Upload resume** → pick a **PDF** → permission/picker opens → summary lands in the box,
   status shows "Loaded and summarized". Try a **DOCX** and a **TXT** too.
2. Confirm a real PDF's text actually extracts (the Hermes/pdf.js risk). If it returns the
   "couldn't read text" error on a normal text PDF, on-device pdf.js isn't working → fall back plan:
   LLM-native PDF (Claude reads the PDF) or DOCX/TXT-only.
3. Companion mode: ask something **not** in the resume → Hue should NOT invent a company/project;
   it should generalize or use a `[placeholder]`. Ask something **in** the resume → it should use it.
4. Additional context field feeds answers.

## ⚠️ On-device pdf.js abandoned for PDFs → LLM-native PDF (2026-06-18)
The on-device pdf.js path (the whole unpdf/Hermes effort above) **produced garbled text on real
hardware** and was replaced. Root cause: `unpdf`'s `getDocumentProxy` only wires pdf.js's
`standardFontDataUrl` + `disableFontFace` when `isNode` is true. On Hermes (`isNode` and `isBrowser`
both false) pdf.js gets **no standard-font/CMap data** and runs `useSystemFonts: true`, so
glyph→Unicode mapping is guessed for any PDF using standard fonts (≈ every résumé). Output wasn't
empty — it was *wrong characters*, which the cleanup LLM then "corrected" into a plausible-but-fake
summary (the user's report: "not even my real name, inaccurate"). Desktop dodges this only because it
runs unpdf inside Chromium, which supplies the font/CMap infrastructure.

**Fix (chosen with the user — LLM-native PDF):**
- **PDF** is now sent as a base64 **document block** to the configured LLM, which reads the rendered
  pages natively. New `LlmDocumentBlock` in `lib/types.ts`; `lib/anthropic.ts` maps it to Anthropic's
  `{type:'document', source:{type:'base64', media_type:'application/pdf', …}}` (GA, no beta header).
  `lib/resume.ts` reads the file via `new File(uri).base64()` (8 MB cap) → `cleanResumeFromPdf`.
- **Provider scope:** only **Anthropic** accepts PDF here. For OpenAI-compat providers (google/groq/
  mistral/cohere) `lib/resume.ts` throws a clear "switch to Anthropic or upload DOCX/TXT" error, and
  `toOpenAiContent` rejects document blocks defensively.
- **DOCX/TXT unchanged** — still extracted on-device (pure JS) then LLM-cleaned, with the raw-text
  fallback. The `raw:true` path now only applies to DOCX/TXT.
- **Privacy posture unchanged:** the cleanup step already sent résumé content to the user's own LLM
  (BYO key, no backend); sending the PDF bytes there crosses no new boundary.
- **Settings UI:** the PDF-specific "decorative fonts can mis-read" warning is gone; replaced with a
  light "give it a quick read" nudge for all formats.

**Dead code to remove (follow-up, left in place to keep this fix focused):** nothing imports
`lib/pdfExtractor.ts` / `lib/pdfPolyfills.ts` anymore, so `unpdf` drops out of the bundle. The
`metro.config.js` unpdf alias, the `babel.config.js` `import.meta` plugin (+ `babel-preset-expo` dep),
and the `unpdf` dependency can all be removed once this is verified on device. See
[[Metro unpdf Resolution Fix]] for what to revert.

**✅ Removed 2026-06-19 ([[Latency Caching and Test Infra Pass]]).** Deleted both files, the
`metro.config.js` unpdf block, `babel.config.js` (Expo auto-applies `babel-preset-expo` now —
its only job was neutralizing pdf.js's `import.meta`), and the `unpdf` + `@babel/plugin-syntax-import-meta`
deps. Done ahead of the on-device verify because the unpdf path is dead either way (the verify's
fallback is DOCX/TXT-only, never a return to unpdf). Verified safe with `expo export --platform android`:
1585 modules → clean Hermes `.hbc` (was 1594 with unpdf). `babel-preset-expo` kept as an explicit devDep.

## Next
- On-device verify the LLM-native PDF path (Anthropic key → pick a PDF → real name lands; non-Anthropic
  provider → clear DOCX/TXT message). Then remove the dead unpdf plumbing above.
- Then **Phase 3 vision** (expo-camera / expo-image-picker → vision LLM).
- Sync desktop's `HUMAN_VOICE_GUIDANCE` with the extended mobile copy.
