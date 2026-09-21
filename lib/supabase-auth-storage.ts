import type { SupportedStorage } from '@supabase/supabase-js'

const memoryStore: Record<string, string> = {}

function getBrowserLocalStorage(): Storage | null {
  try {
    if (typeof globalThis !== 'undefined' && globalThis.localStorage) {
      return globalThis.localStorage
    }
  } catch {
    return null
  }

  return null
}

export const supabaseAuthStorage: SupportedStorage = {
  getItem(key) {
    const storage = getBrowserLocalStorage()

    if (storage) {
      return storage.getItem(key)
    }

    return memoryStore[key] ?? null
  },
  setItem(key, value) {
    const storage = getBrowserLocalStorage()

    if (storage) {
      storage.setItem(key, value)
      return
    }

    memoryStore[key] = value
  },
  removeItem(key) {
    const storage = getBrowserLocalStorage()

    if (storage) {
      storage.removeItem(key)
      return
    }

    delete memoryStore[key]
  },
}
