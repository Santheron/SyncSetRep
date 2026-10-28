import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { useAuth } from '@/lib/auth-context';
import { getAuthEmailRedirectTo } from '@/lib/auth-redirect';
import {
  CONFIRMATION_REQUEST_ACCEPTED,
  RESEND_COOLDOWN_MS,
  resendCooldownSeconds,
} from '@/lib/auth-signup';

const palette = Colors.dark;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp, resendSignUpConfirmation } = useAuth();
  const confirmationRedirect = getAuthEmailRedirectTo();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingEmail, setPendingEmail] = useState<string | null>(null);
  const [resendAvailableAt, setResendAvailableAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const cooldownSeconds = resendCooldownSeconds(resendAvailableAt, now);

  useEffect(() => {
    if (!pendingEmail) {
      return;
    }

    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(timer);
    };
  }, [pendingEmail]);

  async function submit() {
    if (isSubmitting) {
      return;
    }

    if (!displayName.trim()) {
      setErrorMessage('Enter a display name.');
      return;
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      setErrorMessage('Enter a valid email address.');
      return;
    }

    if (password.length < 8) {
      setErrorMessage('Password must be at least 8 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await signUp(email, password, displayName);
    setIsSubmitting(false);

    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    if (result.needsConfirmation) {
      const requestedAt = Date.now();
      setPendingEmail(email.trim());
      setResendAvailableAt(requestedAt + RESEND_COOLDOWN_MS);
      setNow(requestedAt);
    }
  }

  async function resendConfirmation() {
    if (!pendingEmail || isSubmitting || cooldownSeconds > 0) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    const result = await resendSignUpConfirmation(pendingEmail);
    setIsSubmitting(false);

    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    const requestedAt = Date.now();
    setResendAvailableAt(requestedAt + RESEND_COOLDOWN_MS);
    setNow(requestedAt);
  }

  function editSignup() {
    setPendingEmail(null);
    setErrorMessage(null);
    setIsSubmitting(false);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <Screen keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>SyncSetRep</Text>
        <Text style={styles.title}>{pendingEmail ? 'Check your email' : 'Sign Up'}</Text>
        <Text style={styles.subtitle}>
          {pendingEmail
            ? CONFIRMATION_REQUEST_ACCEPTED
            : 'Create an account to keep your workouts private.'}
        </Text>
        <Text accessibilityLabel="Confirmation redirect" style={styles.diagnostic}>
          Email links return to {confirmationRedirect}
        </Text>

        {pendingEmail ? (
          <>
            <Text style={styles.info}>{pendingEmail}</Text>
            {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Resend confirmation email"
              disabled={isSubmitting || cooldownSeconds > 0}
              onPress={() => {
                void resendConfirmation();
              }}
              style={({ pressed }) => [
                styles.primaryButton,
                (pressed || isSubmitting || cooldownSeconds > 0) && styles.pressed,
              ]}>
              <Text style={styles.primaryButtonLabel}>
                {isSubmitting
                  ? 'Requesting...'
                  : cooldownSeconds > 0
                    ? `Resend available in ${cooldownSeconds}s`
                    : 'Resend confirmation email'}
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Use a different email"
              onPress={editSignup}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonLabel}>Use a different email</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Sign in instead"
              onPress={() => router.replace('/sign-in')}
              style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
              <Text style={styles.secondaryButtonLabel}>Already have an account? Sign In</Text>
            </Pressable>
          </>
        ) : null}

        {pendingEmail ? null : (
        <>
        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Display name</Text>
          <TextInput
            accessibilityLabel="Display name"
            autoCapitalize="words"
            autoComplete="name"
            onChangeText={setDisplayName}
            placeholder="Your name"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={displayName}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Email</Text>
          <TextInput
            accessibilityLabel="Email"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={palette.muted}
            style={styles.input}
            value={email}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Password</Text>
          <TextInput
            accessibilityLabel="Password"
            autoCapitalize="none"
            autoComplete="new-password"
            onChangeText={setPassword}
            placeholder="At least 8 characters"
            placeholderTextColor={palette.muted}
            secureTextEntry
            style={styles.input}
            value={password}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.fieldLabel}>Confirm password</Text>
          <TextInput
            accessibilityLabel="Confirm password"
            autoCapitalize="none"
            autoComplete="new-password"
            onChangeText={setConfirmPassword}
            placeholder="Repeat password"
            placeholderTextColor={palette.muted}
            secureTextEntry
            style={styles.input}
            value={confirmPassword}
          />
        </View>

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign Up"
          disabled={isSubmitting}
          onPress={() => {
            void submit();
          }}
          style={({ pressed }) => [styles.primaryButton, (pressed || isSubmitting) && styles.pressed]}>
          <Text style={styles.primaryButtonLabel}>
            {isSubmitting ? 'Creating account...' : 'Sign Up'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in instead"
          onPress={() => router.replace('/sign-in')}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonLabel}>Already have an account? Sign In</Text>
        </Pressable>
        </>
        )}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: palette.background,
  },
  kicker: {
    color: palette.accent,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  title: {
    color: palette.text,
    fontSize: 32,
    fontWeight: '800',
  },
  subtitle: {
    color: palette.muted,
    fontSize: 16,
    marginBottom: 4,
  },
  diagnostic: {
    color: palette.muted,
    fontSize: 13,
  },
  field: {
    gap: 8,
  },
  fieldLabel: {
    color: palette.muted,
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  input: {
    minHeight: 48,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    color: palette.text,
    fontSize: 16,
    paddingHorizontal: 12,
  },
  error: {
    color: palette.text,
    fontSize: 16,
  },
  info: {
    color: palette.accent,
    fontSize: 16,
    fontWeight: '700',
  },
  primaryButton: {
    backgroundColor: palette.accent,
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    marginTop: 8,
  },
  primaryButtonLabel: {
    color: palette.accentText,
    fontSize: 20,
    fontWeight: '800',
  },
  secondaryButton: {
    minHeight: 64,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 18,
    borderWidth: 1,
    borderColor: palette.accent,
    backgroundColor: palette.background,
  },
  secondaryButtonLabel: {
    color: palette.accent,
    fontSize: 16,
    fontWeight: '800',
    textAlign: 'center',
  },
  pressed: {
    opacity: 0.85,
  },
});
