// Pure, dependency-free text helpers for the résumé flow: file-type routing, DOCX-XML
// stripping, and whitespace normalization. Split out of resume.ts (which pulls in
// expo-document-picker / expo-file-system / the LLM clients) so this logic can be
// unit-tested directly without mocking native modules.

export type ResumeFileType = 'pdf' | 'docx' | 'txt'

/**
 * Route a picked file to a supported résumé type by extension first, then MIME type.
 * Returns null for anything we can't parse, so the caller can show a clear "pick a
 * PDF/DOCX/TXT" message rather than failing deep in extraction.
 */
export function resolveFileType(
  name: string | undefined,
  mimeType: string | undefined,
): ResumeFileType | null {
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

/** Turn WordprocessingML into plain text: tabs, breaks, and paragraph boundaries → text. */
export function docxXmlToText(xml: string): string {
  const withBreaks = xml
    .replace(/<w:tab\b[^>]*\/?>/g, '\t')
    .replace(/<w:br\b[^>]*\/?>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeXmlEntities(withBreaks)
}

export function decodeXmlEntities(s: string): string {
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

/** Collapse runs of whitespace/blank lines left behind by extraction, without reflowing. */
export function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
