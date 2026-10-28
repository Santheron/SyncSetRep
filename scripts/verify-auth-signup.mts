import assert from 'node:assert/strict';

import {
  callbackIsPasswordRecovery,
  CONFIRMATION_REQUEST_ACCEPTED,
  interpretResendConfirmation,
  interpretSignUpResult,
  otpTypeForTokenHash,
  resendCooldownSeconds,
  RESEND_COOLDOWN_MS,
} from '../lib/auth-signup.ts';
import { readExpoConfigIdentity, selectAuthRedirect } from '../lib/auth-scheme.ts';

const newAccount = interpretSignUpResult({
  error: null,
  hasUser: true,
  hasSession: false,
  identityCount: 1,
});
const existingAccount = interpretSignUpResult({
  error: { message: 'User already registered', status: 400 },
  hasUser: false,
  hasSession: false,
  identityCount: null,
});
const obfuscatedAccount = interpretSignUpResult({
  error: null,
  hasUser: true,
  hasSession: false,
  identityCount: 0,
});

assert.equal(newAccount.kind, 'confirmation');
assert.equal(existingAccount.kind, 'confirmation');
assert.equal(obfuscatedAccount.kind, 'confirmation');
assert.equal(JSON.stringify(newAccount), JSON.stringify(existingAccount));
assert.equal(JSON.stringify(newAccount), JSON.stringify(obfuscatedAccount));

assert.equal(
  interpretSignUpResult({
    error: null,
    hasUser: true,
    hasSession: true,
    identityCount: 1,
  }).kind,
  'signed-in',
);
assert.equal(
  interpretSignUpResult({
    error: { message: 'email rate limit exceeded', status: 429 },
    hasUser: false,
    hasSession: false,
    identityCount: null,
  }).kind,
  'rate-limit',
);
assert.equal(
  interpretSignUpResult({
    error: { message: 'Password should be at least 8 characters', status: 422 },
    hasUser: false,
    hasSession: false,
    identityCount: null,
  }).kind,
  'error',
);

assert.equal(interpretResendConfirmation(null).kind, 'accepted');
assert.equal(interpretResendConfirmation({ message: 'User not found', status: 400 }).kind, 'accepted');
assert.equal(interpretResendConfirmation({ status: 429, message: 'Too many requests' }).kind, 'rate-limit');
assert.equal(
  interpretResendConfirmation({ message: 'Signup is disabled', status: 400 }).kind,
  'error',
);

assert.equal(/we sent|has been sent|email was sent|was delivered/i.test(CONFIRMATION_REQUEST_ACCEPTED), false);
assert.match(CONFIRMATION_REQUEST_ACCEPTED, /cannot tell whether the message arrived/i);
assert.equal(resendCooldownSeconds(1_000 + RESEND_COOLDOWN_MS, 1_000), 60);
assert.equal(resendCooldownSeconds(1_000, 2_000), 0);

assert.equal(otpTypeForTokenHash('signup', true), 'signup');
assert.equal(otpTypeForTokenHash('recovery', false), 'recovery');
assert.equal(otpTypeForTokenHash(undefined, false), 'signup');
assert.equal(otpTypeForTokenHash(undefined, true), 'recovery');
assert.equal(
  callbackIsPasswordRecovery({
    urlType: 'signup',
    passwordResetPending: true,
    sessionIsRecovery: true,
  }),
  false,
);
assert.equal(
  callbackIsPasswordRecovery({
    urlType: 'recovery',
    passwordResetPending: false,
    sessionIsRecovery: false,
  }),
  true,
);
assert.equal(
  callbackIsPasswordRecovery({
    urlType: undefined,
    passwordResetPending: true,
    sessionIsRecovery: false,
  }),
  true,
);

const metroWithoutVariant = selectAuthRedirect({
  appVariant: null,
  dev: true,
  configuredAndroidPackage: 'com.akagi253.workouttracker',
  configuredScheme: 'workouttracker',
});
assert.equal(metroWithoutVariant.scheme, 'workouttracker-dev');
assert.equal(metroWithoutVariant.redirectTo, 'workouttracker-dev://auth/callback');
assert.equal(metroWithoutVariant.source, 'development-runtime');
assert.equal(metroWithoutVariant.redirectTo.includes('?'), false);
assert.equal(metroWithoutVariant.redirectTo.includes('#'), false);

const installedDevBinary = selectAuthRedirect({
  appVariant: null,
  dev: true,
  embeddedAndroidPackage: 'com.akagi253.workouttracker.dev',
  embeddedScheme: 'workouttracker-dev',
  configuredAndroidPackage: 'com.akagi253.workouttracker',
  configuredScheme: 'workouttracker',
});
assert.equal(installedDevBinary.scheme, 'workouttracker-dev');
assert.equal(installedDevBinary.source, 'embedded-android-package');

const installedReleaseBinary = selectAuthRedirect({
  appVariant: 'development',
  dev: true,
  embeddedAndroidPackage: 'com.akagi253.workouttracker',
  embeddedScheme: 'workouttracker',
  configuredScheme: 'workouttracker-dev',
});
assert.equal(installedReleaseBinary.scheme, 'workouttracker');
assert.equal(installedReleaseBinary.redirectTo, 'workouttracker://auth/callback');
assert.equal(installedReleaseBinary.source, 'embedded-android-package');

const productionVariant = selectAuthRedirect({
  appVariant: 'production',
  dev: false,
  configuredScheme: 'workouttracker',
});
assert.equal(productionVariant.scheme, 'workouttracker');
assert.equal(productionVariant.source, 'app-variant');

const previewVariant = selectAuthRedirect({
  appVariant: 'preview',
  dev: true,
});
assert.equal(previewVariant.scheme, 'workouttracker');
assert.equal(previewVariant.source, 'app-variant');

const releaseConfig = selectAuthRedirect({
  appVariant: null,
  dev: false,
  configuredAndroidPackage: 'com.akagi253.workouttracker',
  configuredScheme: 'workouttracker',
});
assert.equal(releaseConfig.scheme, 'workouttracker');
assert.equal(releaseConfig.source, 'configured-scheme');

const recoveryUsesSameSelection = selectAuthRedirect({
  appVariant: null,
  dev: true,
  embeddedAndroidPackage: 'com.akagi253.workouttracker.dev',
});
assert.equal(recoveryUsesSameSelection.redirectTo, installedDevBinary.redirectTo);

const embeddedManifest = readExpoConfigIdentity(
  JSON.stringify({
    scheme: 'workouttracker-dev',
    android: { package: 'com.akagi253.workouttracker.dev' },
    extra: { eas: { projectId: 'ignored' } },
  }),
);
assert.equal(embeddedManifest.androidPackage, 'com.akagi253.workouttracker.dev');
assert.equal(embeddedManifest.scheme, 'workouttracker-dev');

const updatesManifest = readExpoConfigIdentity({
  extra: {
    expoClient: {
      scheme: 'workouttracker',
      android: { package: 'com.akagi253.workouttracker' },
    },
  },
});
assert.equal(updatesManifest.scheme, 'workouttracker');
assert.equal(updatesManifest.androidPackage, 'com.akagi253.workouttracker');

const diagnosticKeys = Object.keys(metroWithoutVariant);
for (const forbidden of ['token', 'code', 'password', 'secret', 'email', 'key']) {
  assert.equal(
    diagnosticKeys.some((name) => name.toLowerCase().includes(forbidden)),
    false,
    forbidden,
  );
}

console.log('auth signup checks passed');
