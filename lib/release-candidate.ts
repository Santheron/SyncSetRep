// Metro inlines this static member expression at bundle time.
// Development, preview, production, and local Expo leave it unset, so those
// builds stay off. The unbuilt release-candidate EAS profile sets it to 1.
// The installed application was built before this switch existed.
export const RELEASE_CANDIDATE_FEATURES_ENABLED =
  process.env.EXPO_PUBLIC_SYNCSETREP_RC === '1';
