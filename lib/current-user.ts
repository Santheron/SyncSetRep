import { supabase } from '@/lib/supabase'

type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export async function getAuthenticatedUserId(): Promise<Result<string>> {
  const { data, error } = await supabase.auth.getUser()

  if (error || !data.user) {
    return { ok: false, error: 'You must be signed in to continue.' }
  }

  return { ok: true, data: data.user.id }
}
