import * as DocumentPicker from 'expo-document-picker'
import { File } from 'expo-file-system'
import { strFromU8, unzipSync } from 'fflate'

import { AnthropicError, streamAnthropic } from './anthropic'
import {
  isOpenAiCompatProvider,
  keyFieldFor,
  modelFieldFor,
  OpenAiCompatError,
  streamOpenAiCompat,
} from './openai-compat'
import {
  docxXmlToText,
  normalizeWhitespace,
  resolveFileType,
  type ResumeFileType,
} from './resume-text'
import type { HueSettings, LlmMessage, LlmStreamRequest } from './types'

// Resume upload for mobile, the analogue of desktop's resume.ts + resumeCleanup.ts
// (..\..\hue-desktop\src\renderer\src\lib\). The user picks a PDF/DOCX/TXT, and we turn it
// into a clean, structured plain-text summary that feeds the interview system prompt:
//
//   - DOCX / TXT — extracted ON-DEVICE (the file itself never leaves the phone): TXT is read
//     directly; DOCX is unzipped with fflate and its word/document.xml markup stripped (pure JS,
//     Hermes-safe). The extracted text is then run through the configured LLM once to repair
//     ordering/line-break noise into the summary.
//   - PDF — two paths, picked by whether an Anthropic key is configured:
//     · WITH an Anthropic key: read NATIVELY by the LLM. We send the PDF itself (base64) to
//       Anthropic, which sees the rendered pages and produces the cleaned summary in one pass.
//       This is the accurate path and needs no on-device PDF engine.
//     · WITHOUT an Anthropic key: extract the text ON-DEVICE via pdf.js (unpdf), then clean it
//       through whatever provider is configured (Groq/Google/…), exactly like DOCX/TXT. This
//       lets any provider accept a PDF without an Anthropic key. Caveat: under Hermes pdf.js has
//       no standard-font/CMap data (unpdf only wires those up under Node), so glyph→Unicode
//       mapping is guessed for PDFs that embed subsetted fonts without a ToUnicode map — text
//       (names especially) can come out garbled, and the cleanup LLM may "correct" garbage into
//       a plausible-but-wrong summary. The UI nudges the user to verify the result; this fallback
//       trades accuracy for not requiring an Anthropic key, by explicit choice.
//
// Privacy note: this does NOT change the data posture. The cleanup step already sends résumé
// content to the user's own configured LLM (BYO key, no backend); sending the PDF bytes there
// instead of the on-device-extracted text crosses no new boundary.

export type { ResumeFileType }

export interface ResumeParseResult {
  /** Cleaned, structured plain-text summary, ready to drop into settings + the prompt. */
  summary: string
  fileName: string
  fileType: ResumeFileType
  /**
   * True when the LLM cleanup pass was skipped or failed and `summary` is the raw
   * extracted text. The UI surfaces this so the user knows to check their API key.
   */
  raw: boolean
}

/** Raised with a user-facing message when picking/extracting/cleaning a resume fails. */
export class ResumeError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ResumeError'
  }
}

// MIME types we let the picker surface; the file extension is the fallback router.
const PICKER_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
]

const MAX_EXTRACT_CHARS = 24000 // cap on the raw text (DOCX/TXT) we hand to the cleanup LLM
const MAX_SUMMARY_CHARS = 6000 // cap on what we persist into settings
const MAX_PDF_BYTES = 8 * 1024 * 1024 // 8 MB raw cap; base64 inflates ~33%, well under provider limits
const CLEANUP_TIMEOUT_MS = 60000

/**
 * Let the user pick a resume, extract its text on-device, and run it through the
 * configured LLM to produce a clean summary. Resolves to null if the user cancels.
 * Throws {@link ResumeError} with a user-facing message on any failure.
 */
export async function pickAndParseResume(settings: HueSettings): Promise<ResumeParseResult | null> {
  let picked: DocumentPicker.DocumentPickerResult
  try {
    picked = await DocumentPicker.getDocumentAsync({
      type: PICKER_TYPES,
      copyToCacheDirectory: true, // required so we can read the file right after picking
      multiple: false,
    })
  } catch (e) {
    throw new ResumeError(`Couldn't open the file picker: ${errText(e)}`)
  }

  if (picked.canceled) return null
  const asset = picked.assets?.[0]
  if (!asset) return null

  const fileType = resolveFileType(asset.name, asset.mimeType)
  if (!fileType) {
    throw new ResumeError(
      `Unsupported file${asset.name ? ` "${asset.name}"` : ''}. Pick a PDF, DOCX, or TXT resume.`,
    )
  }

  // PDF: prefer the accurate native read when an Anthropic key is configured — the cleanup
  // is a one-shot background task, so it can use Anthropic regardless of the live provider,
  // and the resulting summary then feeds whatever provider the user actually runs with.
  // Without an Anthropic key, fall back to on-device text extraction (imperfect; see the
  // module header) cleaned through the configured provider, so a Groq/Google/… user can
  // still upload a PDF — they just verify the result.
  if (fileType === 'pdf') {
    if (settings.anthropicApiKey.trim()) {
      const dataBase64 = await readPdfBase64(asset.uri)
      // No on-device text to fall back to, so a cleanup failure (no key, network) surfaces
      // its message rather than silently degrading to garbage.
      const summary = await cleanResumeFromPdf(settings, dataBase64)
      return { summary: clampSummary(summary), fileName: asset.name, fileType, raw: false }
    }
    return parseFromExtractedText(settings, await extractPdfTextOnDevice(asset.uri), asset.name, fileType)
  }

  // DOCX / TXT: extract text on-device, then clean it with the LLM.
  return parseFromExtractedText(
    settings,
    await extractText(asset.uri, fileType),
    asset.name,
    fileType,
  )
}

/**
 * Shared tail for the on-device-extracted formats (DOCX, TXT, and the no-Anthropic PDF
 * fallback): validate that we got text, clean it through the configured provider, and fall
 * back to the raw extracted text (raw: true) if cleanup fails so the user still gets
 * something editable rather than nothing.
 */
async function parseFromExtractedText(
  settings: HueSettings,
  rawExtracted: string,
  fileName: string,
  fileType: ResumeFileType,
): Promise<ResumeParseResult> {
  const extracted = rawExtracted.trim()
  if (!extracted) {
    throw new ResumeError(
      'That file had no readable text. Try another export, or paste your summary below.',
    )
  }

  const capped = extracted.slice(0, MAX_EXTRACT_CHARS)

  // Clean + structure with the LLM. If that fails (e.g. no API key configured, or a
  // network error), fall back to the raw extracted text so the user still gets something
  // editable rather than nothing.
  try {
    const summary = await cleanResumeText(settings, capped)
    return { summary: clampSummary(summary), fileName, fileType, raw: false }
  } catch {
    return { summary: clampSummary(capped), fileName, fileType, raw: true }
  }
}

/** Read a picked PDF as base64, enforcing a size cap before it goes to the LLM. */
async function readPdfBase64(uri: string): Promise<string> {
  const file = new File(uri)
  if (typeof file.size === 'number' && file.size > MAX_PDF_BYTES) {
    throw new ResumeError(
      `That PDF is too large (${Math.round(file.size / (1024 * 1024))} MB). Use a résumé under ${MAX_PDF_BYTES / (1024 * 1024)} MB, or upload a DOCX/TXT export.`,
    )
  }
  try {
    return await file.base64()
  } catch (e) {
    throw new ResumeError(`Couldn't read that PDF: ${errText(e)}`)
  }
}

// On-device text extraction for the formats we can parse reliably in pure JS: TXT and
// DOCX. PDF with an Anthropic key is read natively (see pickAndParseResume); only the
// no-Anthropic PDF fallback reaches extractPdfTextOnDevice below.
async function extractText(uri: string, fileType: 'docx' | 'txt'): Promise<string> {
  const file = new File(uri)
  if (fileType === 'txt') {
    return normalizeWhitespace(await file.text())
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return normalizeWhitespace(extractDocxText(bytes))
}

/**
 * On-device PDF text extraction for the no-Anthropic-key fallback. Lazily imports the heavy
 * pdf.js bundle (lib/pdfExtractor) only when a PDF is actually picked without an Anthropic
 * key, so it never loads on the accurate native path or for DOCX/TXT. Accuracy is best-effort
 * (see the module header) — the caller cleans the text and the UI nudges the user to verify.
 */
async function extractPdfTextOnDevice(uri: string): Promise<string> {
  const file = new File(uri)
  if (typeof file.size === 'number' && file.size > MAX_PDF_BYTES) {
    throw new ResumeError(
      `That PDF is too large (${Math.round(file.size / (1024 * 1024))} MB). Use a résumé under ${MAX_PDF_BYTES / (1024 * 1024)} MB, or upload a DOCX/TXT export.`,
    )
  }
  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await file.arrayBuffer())
  } catch (e) {
    throw new ResumeError(`Couldn't read that PDF: ${errText(e)}`)
  }
  try {
    const { extractPdfText } = await import('./pdfExtractor')
    return normalizeWhitespace(await extractPdfText(bytes))
  } catch (e) {
    throw new ResumeError(
      `Couldn't extract text from that PDF: ${errText(e)}. Upload a DOCX or TXT export, ` +
        'or add an Anthropic API key in Settings to read PDFs natively.',
    )
  }
}

/** DOCX is a ZIP; the body text lives in word/document.xml. Unzip and strip the markup. */
function extractDocxText(bytes: Uint8Array): string {
  let entries: Record<string, Uint8Array>
  try {
    entries = unzipSync(bytes)
  } catch {
    throw new ResumeError("Couldn't open that DOCX (it may be corrupt). Try re-saving it.")
  }
  const doc = entries['word/document.xml']
  if (!doc) throw new ResumeError('That DOCX has no readable document body.')
  return docxXmlToText(strFromU8(doc))
}
// Ported from desktop's resumeCleanup.ts CLEANUP_SYSTEM, plus a mobile-specific rule to
// reproduce proper nouns exactly (so the LLM never "corrects" a real, unusual name into a
// plausible-but-wrong one). The anti-fabrication rule ("NEVER invent, embellish, or guess")
// is the first line of defense for the user's "don't build fake scenarios" requirement — the
// answer-time prompts are the second.
const CLEANUP_SYSTEM = `You clean up résumé text that was extracted from a PDF, DOCX, or TXT file. The raw text often has columns merged out of order, broken line breaks, page numbers, and repeated header/footer noise.

Rewrite it into one clear, well-organized plain-text summary of the candidate's background that an interview assistant can read easily. Rules:
- Keep every real fact: name, job titles, employers, dates, education, skills, projects, and measurable achievements. Do not drop details.
- Fix ordering and line breaks so it reads naturally, grouped into sections (e.g. Summary, Experience, Education, Skills).
- Remove extraction noise: page numbers, repeated headers/footers, stray symbols, broken hyphenation.
- NEVER invent, embellish, or guess. If something is unclear or garbled beyond recognition, leave it out.
- Reproduce names, employers, and other proper nouns EXACTLY as written, character for character. Never "correct" an unusual-looking name into a more common one — an odd spelling is almost always the real one.
- Output ONLY the cleaned summary as plain text. No preamble, no markdown, no code fences, no commentary.`

// Instruction paired with the PDF document block so the model knows to read the attachment
// and re-states the exact-name rule at the point of use (defense in depth with CLEANUP_SYSTEM).
const PDF_CLEANUP_INSTRUCTION =
  'Read the résumé in the attached PDF and clean it up following your instructions. ' +
  'Reproduce the candidate’s name and every other proper noun exactly as they appear in the PDF.'

/** Reorganize raw resume text into a clean, structured plain-text summary via the LLM. */
async function cleanResumeText(settings: HueSettings, rawText: string): Promise<string> {
  return runCleanup(settings, [{ role: 'user', content: rawText }])
}

/**
 * Clean a résumé the LLM reads natively from a base64 PDF document block. Forced through
 * Anthropic because it's the only provider here that accepts PDF document blocks; the
 * caller has already verified an Anthropic key is present.
 */
async function cleanResumeFromPdf(settings: HueSettings, dataBase64: string): Promise<string> {
  return runCleanup(
    settings,
    [
      {
        role: 'user',
        content: [
          { type: 'document', mediaType: 'application/pdf', dataBase64 },
          { type: 'text', text: PDF_CLEANUP_INSTRUCTION },
        ],
      },
    ],
    { forceAnthropic: true },
  )
}

/** Shared cleanup pass: run the messages through the LLM and validate non-empty output. */
async function runCleanup(
  settings: HueSettings,
  messages: LlmMessage[],
  opts?: CleanupOptions,
): Promise<string> {
  const summary = await completeOnce(
    settings,
    { system: CLEANUP_SYSTEM, messages, maxTokens: 1500 },
    CLEANUP_TIMEOUT_MS,
    opts,
  )
  const trimmed = summary.trim()
  if (!trimmed) throw new ResumeError('The cleanup step returned nothing. Try again.')
  return trimmed
}

interface CleanupOptions {
  /**
   * Force the cleanup through Anthropic, ignoring `settings.llmProvider`. Used for PDFs,
   * which only Anthropic can read natively, so a Groq/Google/etc. user can still upload a
   * PDF as long as they've configured an Anthropic key.
   */
  forceAnthropic?: boolean
}

/**
 * Drive a single non-streaming completion by reusing the streaming LLM clients and
 * accumulating the deltas (the mobile analogue of desktop's completeOnce). Picks the
 * provider/key the same way the voice pipeline does, with its own timeout abort.
 */
async function completeOnce(
  settings: HueSettings,
  req: LlmStreamRequest,
  timeoutMs: number,
  opts?: CleanupOptions,
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let text = ''
  const onDelta = (delta: string): void => {
    text += delta
  }

  try {
    const provider = settings.llmProvider
    if (!opts?.forceAnthropic && isOpenAiCompatProvider(provider)) {
      const apiKey = settings[keyFieldFor(provider)] as string
      const model = settings[modelFieldFor(provider)] as string
      await streamOpenAiCompat(apiKey, provider, model, req, { onDelta }, controller.signal)
    } else {
      await streamAnthropic(settings.anthropicApiKey, settings.model, req, { onDelta }, controller.signal)
    }
  } catch (e) {
    if (controller.signal.aborted) throw new ResumeError('Resume cleanup timed out. Try again.')
    if (e instanceof AnthropicError || e instanceof OpenAiCompatError) {
      throw new ResumeError((e as Error).message)
    }
    throw e
  } finally {
    clearTimeout(timer)
  }

  return text
}

function clampSummary(text: string): string {
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS).trimEnd()}…` : text
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
