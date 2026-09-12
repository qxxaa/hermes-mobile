import { describe, expect, it } from 'vitest'

import { defaultDeviceTtsLang, detectSentenceLang } from './device-tts'

describe('detectSentenceLang', () => {
  it('detects Finnish by stopwords', () => {
    expect(detectSentenceLang('Tämä on todella hieno kaupunki', 'en')).toBe('fi')
  })

  it('detects English by stopwords', () => {
    expect(detectSentenceLang('This is a really nice city', 'fi')).toBe('en')
  })

  it('keeps English when only a proper noun carries diacritics', () => {
    expect(detectSentenceLang('I visited Jyväskylä last summer', 'en')).toBe('en')
  })

  it('keeps English for sentence-initial Finnish place names', () => {
    expect(detectSentenceLang('Jyväskylä is beautiful this time of year', 'en')).toBe('en')
  })

  it('uses lowercase diacritics as a Finnish tiebreak', () => {
    expect(detectSentenceLang('Kissa kävelee pihalla', 'en')).toBe('fi')
  })

  it('inherits the fallback when there is no signal', () => {
    expect(detectSentenceLang('OK', 'fi')).toBe('fi')
    expect(detectSentenceLang('OK', 'en')).toBe('en')
    expect(detectSentenceLang('https://example.com/x?q=1', 'fi')).toBe('fi')
  })

  it('lets majority win on mixed sentences', () => {
    expect(detectSentenceLang('The server vastaa hitaasti today', 'en')).toBe('en')
    expect(detectSentenceLang('Palvelin on slow tänään', 'en')).toBe('fi')
  })
})

describe('defaultDeviceTtsLang', () => {
  it('returns a supported lang tag', () => {
    expect(['en', 'fi']).toContain(defaultDeviceTtsLang())
  })
})
