import type { User } from '@supabase/supabase-js'

import { ensureOwnProgram } from '@/lib/programs'
import { supabase } from '@/lib/supabase'

export type Profile = {
  id: string
  display_name: string | null
  preferred_weight_unit: string
}

function displayNameFromUser(user: User): string | null {
  const metadataName = user.user_metadata?.display_name

  if (typeof metadataName === 'string' && metadataName.trim()) {
    return metadataName.trim()
  }

  const emailName = user.email?.split('@')[0]

  return emailName ? emailName : null
}

export async function ensureProfile(user: User): Promise<void> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, preferred_weight_unit')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    return
  }

  const displayName = displayNameFromUser(user)

  if (!data) {
    await supabase.from('profiles').insert({
      id: user.id,
      display_name: displayName,
      preferred_weight_unit: 'lb',
    })
  } else if (!data.display_name && displayName) {
    await supabase
      .from('profiles')
      .update({ display_name: displayName, updated_at: new Date().toISOString() })
      .eq('id', user.id)
  }

  await ensureOwnProgram()
}

export async function getOwnProfile(): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name, preferred_weight_unit')
    .maybeSingle()

  if (error || !data) {
    return null
  }

  return data as Profile
}
