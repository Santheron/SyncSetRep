export const DEVELOPMENT_AUTH_SCHEME = 'workouttracker-dev';
export const PRODUCTION_AUTH_SCHEME = 'workouttracker';
export const DEVELOPMENT_ANDROID_PACKAGE = 'com.akagi253.workouttracker.dev';
export const PRODUCTION_ANDROID_PACKAGE = 'com.akagi253.workouttracker';

export type AuthSchemeSource =
  | 'embedded-android-package'
  | 'embedded-ios-bundle'
  | 'embedded-scheme'
  | 'app-variant'
  | 'development-runtime'
  | 'configured-scheme'
  | 'linking-url'
  | 'production-fallback';

export type AuthRedirectDiagnostics = {
  scheme: string;
  redirectTo: string;
  source: AuthSchemeSource;
  appVariant: string | null;
  dev: boolean;
  executionEnvironment: string | null;
  embeddedAndroidPackage: string | null;
  embeddedIosBundle: string | null;
  embeddedScheme: string | null;
  configuredAndroidPackage: string | null;
  configuredScheme: string | null;
};

export type AuthSchemeInput = {
  appVariant?: string | null;
  dev: boolean;
  executionEnvironment?: string | null;
  embeddedAndroidPackage?: string | null;
  embeddedIosBundle?: string | null;
  embeddedScheme?: string | null;
  configuredAndroidPackage?: string | null;
  configuredScheme?: string | null;
  linkingUrl?: string | null;
};

type ExpoConfigIdentity = {
  scheme?: unknown;
  android?: { package?: unknown };
  ios?: { bundleIdentifier?: unknown };
  extra?: { expoClient?: unknown };
};

function firstString(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const text = firstString(item);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function emptyIdentity(): {
  scheme: string | null;
  androidPackage: string | null;
  iosBundle: string | null;
} {
  return { scheme: null, androidPackage: null, iosBundle: null };
}

function unwrapExpoConfig(manifest: unknown): ExpoConfigIdentity | null {
  if (typeof manifest === 'string') {
    try {
      return unwrapExpoConfig(JSON.parse(manifest) as unknown);
    } catch {
      return null;
    }
  }

  if (!manifest || typeof manifest !== 'object') {
    return null;
  }

  const record = manifest as ExpoConfigIdentity;
  if (record.extra && typeof record.extra === 'object' && 'expoClient' in record.extra) {
    return unwrapExpoConfig(record.extra.expoClient);
  }

  return record;
}

export function readExpoConfigIdentity(manifest: unknown): {
  scheme: string | null;
  androidPackage: string | null;
  iosBundle: string | null;
} {
  const config = unwrapExpoConfig(manifest);

  if (!config) {
    return emptyIdentity();
  }

  return {
    scheme: firstString(config.scheme),
    androidPackage: firstString(config.android?.package),
    iosBundle: firstString(config.ios?.bundleIdentifier),
  };
}

function schemeForAndroidPackage(packageName: string | null | undefined): string | null {
  if (!packageName) {
    return null;
  }

  if (packageName === DEVELOPMENT_ANDROID_PACKAGE || packageName.endsWith('.dev')) {
    return DEVELOPMENT_AUTH_SCHEME;
  }

  if (packageName === PRODUCTION_ANDROID_PACKAGE) {
    return PRODUCTION_AUTH_SCHEME;
  }

  return null;
}

function schemeForIosBundle(bundleId: string | null | undefined): string | null {
  if (!bundleId) {
    return null;
  }

  if (bundleId.endsWith('.dev')) {
    return DEVELOPMENT_AUTH_SCHEME;
  }

  if (bundleId === 'com.akagi253.workouttracker') {
    return PRODUCTION_AUTH_SCHEME;
  }

  return null;
}

function knownScheme(scheme: string | null | undefined): string | null {
  if (scheme === DEVELOPMENT_AUTH_SCHEME || scheme === PRODUCTION_AUTH_SCHEME) {
    return scheme;
  }

  return null;
}

function redirectTo(scheme: string): string {
  return `${scheme}://auth/callback`;
}

export function selectAuthRedirect(input: AuthSchemeInput): AuthRedirectDiagnostics {
  const appVariant = input.appVariant?.trim() || null;
  const embeddedAndroidPackage = input.embeddedAndroidPackage ?? null;
  const embeddedIosBundle = input.embeddedIosBundle ?? null;
  const embeddedScheme = input.embeddedScheme ?? null;
  const configuredAndroidPackage = input.configuredAndroidPackage ?? null;
  const configuredScheme = input.configuredScheme ?? null;
  const base = {
    appVariant,
    dev: input.dev,
    executionEnvironment: input.executionEnvironment ?? null,
    embeddedAndroidPackage,
    embeddedIosBundle,
    embeddedScheme,
    configuredAndroidPackage,
    configuredScheme,
  };

  const choose = (source: AuthSchemeSource, scheme: string): AuthRedirectDiagnostics => ({
    ...base,
    source,
    scheme,
    redirectTo: redirectTo(scheme),
  });

  const embeddedPackageScheme = schemeForAndroidPackage(embeddedAndroidPackage);
  if (embeddedPackageScheme) {
    return choose('embedded-android-package', embeddedPackageScheme);
  }

  const embeddedBundleScheme = schemeForIosBundle(embeddedIosBundle);
  if (embeddedBundleScheme) {
    return choose('embedded-ios-bundle', embeddedBundleScheme);
  }

  const bakedScheme = knownScheme(embeddedScheme);
  if (bakedScheme) {
    return choose('embedded-scheme', bakedScheme);
  }

  if (appVariant === 'development') {
    return choose('app-variant', DEVELOPMENT_AUTH_SCHEME);
  }

  if (appVariant === 'preview' || appVariant === 'production') {
    return choose('app-variant', PRODUCTION_AUTH_SCHEME);
  }

  // Metro can serve app.config without APP_VARIANT. That config names the
  // production package and scheme even while the development app is running.
  if (input.dev) {
    return choose('development-runtime', DEVELOPMENT_AUTH_SCHEME);
  }

  const configuredPackageScheme = schemeForAndroidPackage(configuredAndroidPackage);
  if (configuredPackageScheme === DEVELOPMENT_AUTH_SCHEME) {
    return choose('configured-scheme', DEVELOPMENT_AUTH_SCHEME);
  }

  const servedScheme = knownScheme(configuredScheme);
  if (servedScheme) {
    return choose('configured-scheme', servedScheme);
  }

  const linkingUrl = input.linkingUrl ?? '';
  if (linkingUrl.startsWith(`${DEVELOPMENT_AUTH_SCHEME}:`)) {
    return choose('linking-url', DEVELOPMENT_AUTH_SCHEME);
  }
  if (linkingUrl.startsWith(`${PRODUCTION_AUTH_SCHEME}:`)) {
    return choose('linking-url', PRODUCTION_AUTH_SCHEME);
  }

  return choose('production-fallback', PRODUCTION_AUTH_SCHEME);
}
