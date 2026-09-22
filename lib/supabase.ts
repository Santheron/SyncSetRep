import 'react-native-url-polyfill/auto'

import { createClient } from '@supabase/supabase-js'

import { supabaseAuthStorage } from '@/lib/supabase-auth-storage'
import { supabaseFetch } from '@/lib/supabase-fetch'

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!
const supabasePublishableKey =
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY!

const authStorageKey = `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`

console.log('[AuthPKCE] detectSessionInUrl: false')
console.log('[AuthPKCE] flowType: pkce')
console.log('[AuthPKCE] storageKey:', authStorageKey)

export const supabase = createClient(
  supabaseUrl,
  supabasePublishableKey,
  {
    auth: {
      storage: supabaseAuthStorage,
      storageKey: authStorageKey,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      fetch: supabaseFetch,
    },
  }
)
