import * as SecureStore from 'expo-secure-store'
import { create } from 'zustand'

import { DEFAULT_SETTINGS } from '@/lib/defaults'
import type { HueSettings } from '@/lib/types'

// Settings store. The entire settings object — including the API keys — is persisted
// as one encrypted record via expo-secure-store (Android Keystore). That keeps the
// keys off plain storage and out of the bundle, which is the only security layer this
// BYO-key, no-backend app needs (vault: Architecture - BYO Key No Backend).
//
// Note: expo-secure-store has historically capped iOS values near 2KB. We're
// Android-first (vault: Platform - Android First), where the limit is generous, so a
// few-KB resume summary is fine. If iOS is lifted later, split non-secret prefs into
// AsyncStorage and keep only the short keys here.

const STORAGE_KEY = 'hue.settings.v1'

interface SettingsStore {
  settings: HueSettings
  /** False until the persisted settings have been loaded from secure storage. */
  hydrated: boolean
  load: () => Promise<void>
  update: (patch: Partial<HueSettings>) => Promise<void>
  reset: () => Promise<void>
}

export const useSettings = create<SettingsStore>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  hydrated: false,

  async load() {
    try {
      const raw = await SecureStore.getItemAsync(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<HueSettings>
        // Merge over defaults so a settings object saved by an older build (missing
        // newly-added fields) still produces a complete, valid HueSettings.
        set({ settings: { ...DEFAULT_SETTINGS, ...parsed }, hydrated: true })
        return
      }
    } catch {
      // Corrupt/unreadable store: fall back to defaults rather than crashing on boot.
    }
    set({ hydrated: true })
  },

  async update(patch) {
    const next = { ...get().settings, ...patch }
    set({ settings: next })
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next))
    } catch (e) {
      // Surface persistence failures to the console only; never throw into the UI
      // mid-edit. The in-memory value still applies for this session.
      console.warn('Failed to persist settings', e)
    }
  },

  async reset() {
    set({ settings: DEFAULT_SETTINGS })
    try {
      await SecureStore.deleteItemAsync(STORAGE_KEY)
    } catch {
      // Nothing persisted yet; ignore.
    }
  },
}))
