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
import type { HueSettings, LlmMessage, LlmStreamRequest } from './types'

// Resume upload for mobile, the analogue of desktop's resume.ts + resumeCleanup.ts
// (..\..\hue-desktop\src\renderer\src\lib\). The user picks a PDF/DOCX/TXT, and we turn it
// into a clean, structured plain-text summary that feeds the interview system prompt:
//
//   - DOCX / TXT — extracted ON-DEVICE (the file itself never leaves the phone): TXT is read
//     directly; DOCX is unzipped with fflate and its word/document.xml markup stripped (pure JS,
//     Hermes-safe). The extracted text is then run through the configured LLM once to repair
//     ordering/line-break noise into the summary.
//   - PDF — read NATIVELY by the LLM. We send the PDF itself (base64) to the model, which sees
//     the rendered pages and produces the cleaned summary in one pass. We previously extracted
//     PDF text on-device via pdf.js (unpdf), but under Hermes pdf.js has no standard-font/CMap
//     data (unpdf only wires those up under Node), so glyph→Unicode mapping was guessed and the
//     extracted text was garbled — names came out wrong and the cleanup LLM then "corrected" the
//     garbage into a plausible-but-fake summary. Native reading is accurate and needs no on-device
//     PDF engine. Anthropic supports PDF document blocks today; other providers can't read PDFs in
//     chat completions, so for those we ask the user for a DOCX/TXT export instead.
//
// Privacy note: this does NOT change the data posture. The cleanup step already sends résumé
// content to the user's own configured LLM (BYO key, no backend); sending the PDF bytes there
// instead of the on-device-extracted text crosses no new boundary.

export type ResumeFileType = 'pdf' | 'docx' | 'txt'

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

  // PDF: read natively by the LLM (the model parses the rendered pages). Only Anthropic
  // accepts PDF document blocks here; for other providers we ask for a DOCX/TXT export.
  if (fileType === 'pdf') {
    if (settings.llmProvider !== 'anthropic') {
      throw new ResumeError(
        'PDF résumés are read by the Anthropic provider. Switch to Anthropic in Settings, or upload a DOCX or TXT export instead.',
      )
    }
    const dataBase64 = await readPdfBase64(asset.uri)
    // No on-device text to fall back to, so a cleanup failure (no key, network) surfaces
    // its message rather than silently degrading to garbage.
    const summary = await cleanResumeFromPdf(settings, dataBase64)
    return { summary: clampSummary(summary), fileName: asset.name, fileType, raw: false }
  }

  // DOCX / TXT: extract text on-device, then clean it with the LLM.
  const extracted = (await extractText(asset.uri, fileType)).trim()
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
    return { summary: clampSummary(summary), fileName: asset.name, fileType, raw: false }
  } catch {
    return { summary: clampSummary(capped), fileName: asset.name, fileType, raw: true }
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

function resolveFileType(name: string | undefined, mimeType: string | undefined): ResumeFileType | null {
  const ext = name?.split('.').pop()?.toLowerCase()
  if (ext === 'pdf' || mimeType === 'application/pdf') return 'pdf'
  if (
    ext === 'docx' ||
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return 'docx'
  }
  if (ext === 'txt' || mimeType === 'text/plain') return 'txt'
  return null
}

// On-device text extraction for the formats we can parse reliably in pure JS: TXT and
// DOCX. PDF is handled separately (read natively by the LLM) and never reaches here.
async function extractText(uri: string, fileType: 'docx' | 'txt'): Promise<string> {
  const file = new File(uri)
  if (fileType === 'txt') {
    return normalizeWhitespace(await file.text())
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  return normalizeWhitespace(extractDocxText(bytes))
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

/** Turn WordprocessingML into plain text: tabs, breaks, and paragraph boundaries → text. */
function docxXmlToText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeXmlEntities(withBreaks)
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => safeCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => safeCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&') // decode last so an escaped "&amp;lt;" stays literal
}

function safeCodePoint(n: number): string {
  try {
    return String.fromCodePoint(n)
  } catch {
    return ''
  }
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

/** Clean a résumé the LLM reads natively from a base64 PDF document block. */
async function cleanResumeFromPdf(settings: HueSettings, dataBase64: string): Promise<string> {
  return runCleanup(settings, [
    {
      role: 'user',
      content: [
        { type: 'document', mediaType: 'application/pdf', dataBase64 },
        { type: 'text', text: PDF_CLEANUP_INSTRUCTION },
      ],
    },
  ])
}

/** Shared cleanup pass: run the messages through the LLM and validate non-empty output. */
async function runCleanup(settings: HueSettings, messages: LlmMessage[]): Promise<string> {
  const summary = await completeOnce(
    settings,
    { system: CLEANUP_SYSTEM, messages, maxTokens: 1500 },
    CLEANUP_TIMEOUT_MS,
  )
  const trimmed = summary.trim()
  if (!trimmed) throw new ResumeError('The cleanup step returned nothing. Try again.')
  return trimmed
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
): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let text = ''
  const onDelta = (delta: string): void => {
    text += delta
  }

  try {
    const provider = settings.llmProvider
    if (isOpenAiCompatProvider(provider)) {
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

/** Collapse runs of whitespace/blank lines left behind by extraction, without reflowing. */
function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function clampSummary(text: string): string {
  return text.length > MAX_SUMMARY_CHARS ? `${text.slice(0, MAX_SUMMARY_CHARS).trimEnd()}…` : text
}

function errText(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
