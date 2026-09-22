/**
 * GoTrue's resetPasswordForEmail() stores a PKCE verifier, then POSTs /recover.
 * If that request throws — including JSON.parse of an empty 200 body —
 * auth-js deletes the verifier it just stored.
 *
 * React Native fetch often yields an empty body on 200 /recover. Treat that
 * as {} so a successful send does not look like a failure.
 */
export async function supabaseFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = String(input)
  const response = await fetch(input, init)
  const isRecover = url.includes('/auth/v1/recover')

  if (!isRecover) {
    return response
  }

  console.log('[AuthPKCE] recover HTTP status:', response.status, 'ok:', response.ok)

  if (!response.ok) {
    return response
  }

  const text = await response.text()
  const empty = text.trim() === ''

  console.log('[AuthPKCE] recover body empty:', empty)

  return new Response(empty ? '{}' : text, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}
