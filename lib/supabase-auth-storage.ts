import type { SupportedStorage } from '@supabase/supabase-js'

const memoryStore: Record<string, string> = {}

function isPkceKey(key: string) {
  return key.includes('code-verifier')
}

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
    const value = storage ? storage.getItem(key) : (memoryStore[key] ?? null)

    if (isPkceKey(key)) {
      console.log('[AuthPKCE] getItem key:', key, 'found:', Boolean(value))
    }

    return value
  },
  setItem(key, value) {
    if (isPkceKey(key)) {
      console.log('[AuthPKCE] setItem key:', key)
    }

    const storage = getBrowserLocalStorage()

    if (storage) {
      storage.setItem(key, value)
      return
    }

    memoryStore[key] = value
  },
  removeItem(key) {
    if (isPkceKey(key)) {
      console.log('[AuthPKCE] removeItem key:', key)
    }

    const storage = getBrowserLocalStorage()

    if (storage) {
      storage.removeItem(key)
      return
    }

    delete memoryStore[key]
  },
}

export function listPkceStorageKeys(): string[] {
  const storage = getBrowserLocalStorage()

  if (storage) {
    const keys: string[] = []

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)

      if (key && isPkceKey(key) && storage.getItem(key)) {
        keys.push(key)
      }
    }

    return keys
  }

  return Object.keys(memoryStore).filter((key) => isPkceKey(key) && Boolean(memoryStore[key]))
}

export function hasPkceVerifier(): boolean {
  return listPkceStorageKeys().length > 0
}
