/**
 * Keep-awake — stop the machine sleeping during long, unattended runs.
 *
 * A device-local preference (each computer keeps its own), off by default. This
 * atom backs the Settings → Advanced picker and mirrors changes to the main
 * process, which owns the real power-save blocker AND its own persisted copy —
 * so a cold launch restores the blocker without the renderer visiting Settings
 * (see electron/main.ts + electron/power-save.ts). Linux/web without the bridge
 * just no-op.
 *
 * Modes: 'off' never holds the blocker; 'while-working' holds it only while a
 * turn is in flight (main reads that from the same active-work reports that
 * drive stream throttling); 'always' holds it around the clock, which is what
 * the pre-mode boolean toggle meant when it was on.
 */

import { atom } from 'nanostores'

import { type KeepAwakeMode } from '@/global'
import { persistString, storedBoolean, storedString } from '@/lib/storage'

export type { KeepAwakeMode }

// Fork note: upstream imports parseKeepAwakeMode from '../../electron/power-save'
// (the Electron shell, stripped here). Local copy — keep in sync with
// electron/power-save.ts.
const KEEP_AWAKE_MODES: readonly KeepAwakeMode[] = ['off', 'while-working', 'always']

function parseKeepAwakeMode(value: unknown): KeepAwakeMode | null {
  if (value === true) {
    return 'always'
  }

  if (value === false) {
    return 'off'
  }

  return typeof value === 'string' && (KEEP_AWAKE_MODES as readonly string[]).includes(value)
    ? (value as KeepAwakeMode)
    : null
}

const KEY = 'hermes.desktop.keepAwakeMode.v1'
/** The boolean the toggle persisted before modes existed; read once to migrate. */
const LEGACY_KEY = 'hermes.desktop.keepAwake.v1'

function initialKeepAwakeMode(): KeepAwakeMode {
  const stored = parseKeepAwakeMode(storedString(KEY))

  if (stored) {
    return stored
  }

  // No mode saved yet: honour what the old toggle said. On meant "always".
  return storedBoolean(LEGACY_KEY, false) ? 'always' : 'off'
}

export const $keepAwakeMode = atom<KeepAwakeMode>(typeof window === 'undefined' ? 'off' : initialKeepAwakeMode())

export function setKeepAwakeMode(mode: KeepAwakeMode): void {
  $keepAwakeMode.set(mode)
}

if (typeof window !== 'undefined') {
  $keepAwakeMode.subscribe(mode => {
    persistString(KEY, mode)
    window.hermesDesktop?.setKeepAwake?.(mode)
  })
}
