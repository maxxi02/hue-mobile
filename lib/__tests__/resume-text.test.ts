import { describe, expect, it } from '@jest/globals'

import {
  decodeXmlEntities,
  docxXmlToText,
  normalizeWhitespace,
  resolveFileType,
} from '../resume-text'

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

describe('resolveFileType', () => {
  it('routes by file extension (case-insensitive)', () => {
    expect(resolveFileType('resume.pdf', undefined)).toBe('pdf')
    expect(resolveFileType('resume.DOCX', undefined)).toBe('docx')
    expect(resolveFileType('notes.txt', undefined)).toBe('txt')
  })

  it('routes by MIME type when the extension is missing or unknown', () => {
    expect(resolveFileType('resume', 'application/pdf')).toBe('pdf')
    expect(resolveFileType(undefined, 'text/plain')).toBe('txt')
    expect(resolveFileType('resume', DOCX_MIME)).toBe('docx')
  })

  it('prefers a known extension over the MIME type', () => {
    expect(resolveFileType('resume.pdf', 'text/plain')).toBe('pdf')
  })

  it('returns null for unsupported files', () => {
    expect(resolveFileType('image.png', 'image/png')).toBeNull()
    expect(resolveFileType(undefined, undefined)).toBeNull()
  })
})

describe('docxXmlToText', () => {
  it('converts tabs, breaks, and paragraph ends to plain text', () => {
    const xml =
      '<w:p><w:r><w:t>Jane</w:t></w:r><w:tab/><w:r><w:t>Doe</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Engineer</w:t></w:r></w:p>'
    expect(docxXmlToText(xml)).toBe('Jane\tDoe\nEngineer\n')
  })

  it('strips unknown tags and decodes entities', () => {
    expect(docxXmlToText('<w:t>R&amp;D &lt;lead&gt;</w:t>')).toBe('R&D <lead>')
  })
})

describe('decodeXmlEntities', () => {
  it('decodes named, decimal, and hex entities', () => {
    expect(decodeXmlEntities('&lt;a&gt; &quot;x&quot; &apos;y&apos;')).toBe('<a> "x" \'y\'')
    expect(decodeXmlEntities('caf&#233;')).toBe('café')
    expect(decodeXmlEntities('&#x41;&#x42;')).toBe('AB')
  })

  it('decodes &amp; last so an escaped entity stays literal', () => {
    expect(decodeXmlEntities('&amp;lt;')).toBe('&lt;')
  })
})

describe('normalizeWhitespace', () => {
  it('normalizes newlines and collapses blank-line runs', () => {
    expect(normalizeWhitespace('a\r\nb\r\n\n\n\nc')).toBe('a\nb\n\nc')
  })

  it('collapses horizontal whitespace and trims padding around newlines', () => {
    expect(normalizeWhitespace('  hello    world  \n   next  ')).toBe('hello world\nnext')
  })
})
