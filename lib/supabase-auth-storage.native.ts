import type { SupportedStorage } from '@supabase/supabase-js'

import 'expo-sqlite/localStorage/install'

function isPkceKey(key: string) {
  return key.includes('code-verifier')
}

function wrapLocalStorage(storage: Storage): SupportedStorage {
  return {
    getItem(key) {
      const value = storage.getItem(key)

      if (isPkceKey(key)) {
        console.log('[AuthPKCE] getItem key:', key, 'found:', Boolean(value))
      }

      return value
    },
    setItem(key, value) {
      if (isPkceKey(key)) {
        console.log('[AuthPKCE] setItem key:', key)
      }
      storage.setItem(key, value)
    },
    removeItem(key) {
      if (isPkceKey(key)) {
        console.log('[AuthPKCE] removeItem key:', key)
      }
      storage.removeItem(key)
    },
  }
}

export const supabaseAuthStorage = wrapLocalStorage(localStorage)

export function listPkceStorageKeys(): string[] {
  const keys: string[] = []

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index)

    if (key && isPkceKey(key) && localStorage.getItem(key)) {
      keys.push(key)
    }
  }

  return keys
}

export function hasPkceVerifier(): boolean {
  return listPkceStorageKeys().length > 0
}
