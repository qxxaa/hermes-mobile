import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { setStickyUserMessagesEnabled } from '@/store/sticky-user-messages'

import { assistantMessage, stubThreadEnvironment, stubThreadViewportSize, ThreadRuntime, userMessage } from '../test-utils'

import { Thread } from '.'

stubThreadEnvironment()
stubThreadViewportSize()

beforeEach(() => {
  window.localStorage.clear()
  setStickyUserMessagesEnabled(true)
})

afterEach(() => {
  cleanup()
})

function renderThread() {
  return render(
    <ThreadRuntime messages={[userMessage('user-1', 'A long user message that should expose the presentation classes.'), assistantMessage()]}>
      <Thread />
    </ThreadRuntime>
  )
}

describe('sticky user message presentation', () => {
  it('pins and clamps user messages when enabled', () => {
    const { container } = renderThread()
    const root = container.querySelector('[data-message-id="user-1"]')

    expect(root?.classList.contains('sticky')).toBe(true)
    expect(root?.classList.contains('z-40')).toBe(true)
    expect(root?.querySelector('.sticky-human-clamp')).toBeTruthy()
  })

  it('shows the full message in normal flow when disabled', () => {
    const { container } = renderThread()

    act(() => setStickyUserMessagesEnabled(false))

    const root = container.querySelector('[data-message-id="user-1"]')
    expect(root?.classList.contains('sticky')).toBe(false)
    expect(root?.classList.contains('z-40')).toBe(false)
    expect(root?.querySelector('.sticky-human-clamp')).toBeFalsy()
  })
})
