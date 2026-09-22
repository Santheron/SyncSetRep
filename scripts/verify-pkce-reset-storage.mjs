/**
 * Proves, without sending email, which /recover responses delete the current
 * PKCE verifier inside supabase-js resetPasswordForEmail().
 */
import { createClient } from '@supabase/supabase-js'

function memoryStorage() {
  const store = new Map()
  return {
    store,
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, value)
    },
    removeItem(key) {
      store.delete(key)
    },
  }
}

function pkceKeys(store) {
  return [...store.keys()].filter((key) => key.includes('code-verifier')).sort()
}

function currentFlowKeys(store) {
  return pkceKeys(store).filter((key) => key.includes('-flow-') && !key.includes('-flows-'))
}

function wrapEmptyRecover(innerFetch) {
  return async (input, init) => {
    const url = String(input)
    const response = await innerFetch(input, init)
    if (!url.includes('/auth/v1/recover') || !response.ok) {
      return response
    }
    const text = await response.text()
    return new Response(text.trim() === '' ? '{}' : text, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    })
  }
}

async function runCase(label, fetchImpl) {
  const storage = memoryStorage()
  const supabase = createClient('https://example.supabase.co', 'sb_publishable_test', {
    auth: {
      storage,
      autoRefreshToken: false,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: { fetch: fetchImpl },
  })

  const { error } = await supabase.auth.resetPasswordForEmail('verify@example.com', {
    redirectTo: 'workouttracker://auth/callback',
  })

  const flows = currentFlowKeys(storage.store)
  console.log(`\n[${label}]`)
  console.log('  error:', error ? `${error.name} ${error.status ?? ''} ${error.message}` : 'none')
  console.log('  current flow slots:', flows.length ? flows.join(', ') : '(none)')
  console.log('  all verifier keys:', pkceKeys(storage.store).join(', ') || '(none)')
  console.log('  current verifier survived:', flows.length > 0)
}

async function main() {
  const json200 = async () => new Response('{}', { status: 200 })
  const empty200 = async () => new Response('', { status: 200 })
  const rateLimited = async () =>
    new Response(JSON.stringify({ message: 'email rate limit exceeded' }), { status: 429 })

  await runCase('200 JSON {} (no wrapper)', json200)
  await runCase('200 empty body (no wrapper)', empty200)
  await runCase('200 empty body (with wrapper)', wrapEmptyRecover(empty200))
  await runCase('429 rate limit (no wrapper)', rateLimited)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
