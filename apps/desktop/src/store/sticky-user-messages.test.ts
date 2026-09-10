import { beforeEach, describe, expect, it, vi } from 'vitest'

const KEY = 'hermes.desktop.stickyUserMessages.v1'

describe('sticky user messages store', () => {
  beforeEach(() => {
    window.localStorage.clear()
    vi.resetModules()
  })

  it('defaults to enabled when no stored value exists', async () => {
    const { $stickyUserMessagesEnabled } = await import('./sticky-user-messages')

    expect($stickyUserMessagesEnabled.get()).toBe(true)
  })

  it('restores the stored preference', async () => {
    window.localStorage.setItem(KEY, 'false')
    const { $stickyUserMessagesEnabled } = await import('./sticky-user-messages')

    expect($stickyUserMessagesEnabled.get()).toBe(false)
  })

  it('persists changes', async () => {
    const { $stickyUserMessagesEnabled, setStickyUserMessagesEnabled } = await import('./sticky-user-messages')

    setStickyUserMessagesEnabled(false)
    expect($stickyUserMessagesEnabled.get()).toBe(false)
    expect(window.localStorage.getItem(KEY)).toBe('false')

    setStickyUserMessagesEnabled(true)
    expect($stickyUserMessagesEnabled.get()).toBe(true)
    expect(window.localStorage.getItem(KEY)).toBe('true')
  })
})
