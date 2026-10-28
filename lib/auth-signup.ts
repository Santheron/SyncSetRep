export type AuthRequestError = {
  message?: string | null;
  status?: number | null;
  code?: string | null;
};

export type SignUpInterpretation =
  | { kind: 'signed-in' }
  | { kind: 'confirmation' }
  | { kind: 'rate-limit'; message: string }
  | { kind: 'error'; message: string };

export type ResendInterpretation =
  | { kind: 'accepted' }
  | { kind: 'rate-limit'; message: string }
  | { kind: 'error'; message: string };

const OTP_TYPES = ['signup', 'invite', 'magiclink', 'recovery', 'email_change', 'email'] as const;

export type AuthOtpType = (typeof OTP_TYPES)[number];

export const CONFIRMATION_REQUEST_ACCEPTED =
  'If this address can receive account mail, a confirmation message will be sent. Open the link on this phone. SyncSetRep cannot tell whether the message arrived.';

export const RESEND_COOLDOWN_MS = 60_000;

const RATE_LIMIT_MESSAGE =
  'Too many confirmation emails were requested. Please wait a minute and try again.';

function isRateLimit(error: AuthRequestError | null): boolean {
  if (!error) {
    return false;
  }

  if (error.status === 429) {
    return true;
  }

  const message = (error.message ?? '').toLowerCase();
  return message.includes('rate limit') || message.includes('too many');
}

function isAmbiguousExistingAccount(error: AuthRequestError | null): boolean {
  const message = (error?.message ?? '').toLowerCase();
  return (
    message.includes('already registered') ||
    message.includes('already been registered') ||
    message.includes('already exists') ||
    message.includes('user already')
  );
}

export function interpretSignUpResult(input: {
  error: AuthRequestError | null;
  hasUser: boolean;
  hasSession: boolean;
  identityCount: number | null;
}): SignUpInterpretation {
  if (isRateLimit(input.error)) {
    return { kind: 'rate-limit', message: RATE_LIMIT_MESSAGE };
  }

  if (input.error && isAmbiguousExistingAccount(input.error)) {
    return { kind: 'confirmation' };
  }

  if (input.error) {
    return {
      kind: 'error',
      message: input.error.message?.trim() || 'Could not create the account. Try again.',
    };
  }

  if (input.hasSession && input.hasUser) {
    return { kind: 'signed-in' };
  }

  if (input.hasUser || input.identityCount === 0) {
    return { kind: 'confirmation' };
  }

  return { kind: 'error', message: 'Could not create the account. Try again.' };
}

export function interpretResendConfirmation(error: AuthRequestError | null): ResendInterpretation {
  if (!error) {
    return { kind: 'accepted' };
  }

  if (isRateLimit(error)) {
    return { kind: 'rate-limit', message: RATE_LIMIT_MESSAGE };
  }

  const message = (error.message ?? '').toLowerCase();

  if (isAmbiguousExistingAccount(error) || message.includes('not found') || message.includes('user not')) {
    return { kind: 'accepted' };
  }

  return {
    kind: 'error',
    message: error.message?.trim() || 'Could not request another confirmation email. Try again.',
  };
}

export function resendCooldownSeconds(availableAt: number, now: number): number {
  if (!Number.isFinite(availableAt) || !Number.isFinite(now)) {
    return 0;
  }

  return Math.max(0, Math.ceil((availableAt - now) / 1000));
}

export function otpTypeForTokenHash(
  type: string | undefined,
  passwordResetPending: boolean,
): AuthOtpType {
  const value = type?.trim() ?? '';

  if ((OTP_TYPES as readonly string[]).includes(value)) {
    return value as AuthOtpType;
  }

  return passwordResetPending ? 'recovery' : 'signup';
}

export function callbackIsPasswordRecovery(input: {
  urlType: string | undefined;
  passwordResetPending: boolean;
  sessionIsRecovery: boolean;
}): boolean {
  const type = input.urlType?.trim();

  if (
    type === 'signup' ||
    type === 'email' ||
    type === 'invite' ||
    type === 'email_change' ||
    type === 'magiclink'
  ) {
    return false;
  }

  if (type === 'recovery') {
    return true;
  }

  return input.sessionIsRecovery || input.passwordResetPending;
}
