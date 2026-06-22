import { describe, expect, it } from '@jest/globals'

import { buildSystemPrompt } from '../prompts'
import type { HueSettings } from '../types'

// buildSystemPrompt only reads these five fields; the rest of HueSettings is irrelevant to
// the prompt, so a partial fixture cast keeps the tests focused (the cast is type-only and
// erased at runtime).
function settings(overrides: Partial<HueSettings>): HueSettings {
  return {
    hueMode: 'companion',
    interviewMode: 'practice',
    jobTitle: '',
    resumeSummary: '',
    additionalContext: '',
    ...overrides,
  } as HueSettings
}

describe('buildSystemPrompt', () => {
  it('builds the companion prompt by default and appends the human-voice guidance', () => {
    const prompt = buildSystemPrompt(settings({ hueMode: 'companion' }))
    expect(prompt).toContain('real-time interview companion')
    expect(prompt).toContain('Sound like a real person')
  })

  it('builds the interviewer prompt in interviewer mode', () => {
    const prompt = buildSystemPrompt(settings({ hueMode: 'interviewer' }))
    expect(prompt).toContain('acting as a professional interviewer')
    expect(prompt).toContain('Sound like a real person')
  })

  it('injects job title, résumé summary, and extra context when present', () => {
    const prompt = buildSystemPrompt(
      settings({
        jobTitle: 'Hotdog Vendor',
        resumeSummary: 'Ten years of grilling.',
        additionalContext: 'Targeting a stadium role.',
      }),
    )
    expect(prompt).toContain('Hotdog Vendor')
    expect(prompt).toContain('Ten years of grilling.')
    expect(prompt).toContain('Targeting a stadium role.')
  })

  it('omits optional context lines when those fields are empty', () => {
    const prompt = buildSystemPrompt(settings({}))
    expect(prompt).not.toContain('interviewing for the role')
  })

  it('adds the STAR instruction in star mode', () => {
    const prompt = buildSystemPrompt(settings({ interviewMode: 'star' }))
    expect(prompt).toContain('STAR method')
  })

  it('builds the assessment prompt in assessment mode without the spoken-voice guidance', () => {
    const prompt = buildSystemPrompt(settings({ hueMode: 'assessment' }))
    expect(prompt).toContain('technical assessment or skills test')
    expect(prompt).toContain('Multiple choice')
    // Assessment answers are read on-screen, not spoken, so the humanizer rules are omitted.
    expect(prompt).not.toContain('Sound like a real person')
  })

  it('uses the job title as the assessment subject and ignores answer style', () => {
    const prompt = buildSystemPrompt(
      settings({ hueMode: 'assessment', jobTitle: 'WordPress Developer', interviewMode: 'star' }),
    )
    expect(prompt).toContain('The assessment is for: WordPress Developer')
    // STAR is a spoken-answer structure; it must not leak into assessment answers.
    expect(prompt).not.toContain('STAR method')
  })
})
