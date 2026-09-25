import { useState } from 'react';
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

const palette = Colors.dark;

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    if (isSubmitting) {
      return;
    }

    if (!EMAIL_PATTERN.test(email.trim())) {
      setErrorMessage('Enter a valid email address.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const result = await requestPasswordReset(email);

    setIsSubmitting(false);

    if (result.error) {
      setErrorMessage(result.error);
      return;
    }

    setEmailSent(true);
  }

  if (emailSent) {
    return (
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.flex}>
        <Screen keyboardShouldPersistTaps="handled">
          <Text style={styles.kicker}>SyncSetRep</Text>
          <Text style={styles.title}>Check your email</Text>
          <Text style={styles.subtitle}>
            If that email is registered, we sent a reset link. Open it on this phone to
            set a new password.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to Sign In"
            onPress={() => router.replace('/sign-in')}
            style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}>
            <Text style={styles.primaryButtonLabel}>Back to Sign In</Text>
          </Pressable>
        </Screen>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <Screen keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>SyncSetRep</Text>
        <Text style={styles.title}>Forgot Password?</Text>
        <Text style={styles.subtitle}>
          Enter your account email and we will send a link to choose a new password.
        </Text>

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

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Send reset link"
          disabled={isSubmitting}
          onPress={() => {
            void submit();
          }}
          style={({ pressed }) => [styles.primaryButton, (pressed || isSubmitting) && styles.pressed]}>
          <Text style={styles.primaryButtonLabel}>
            {isSubmitting ? 'Sending...' : 'Send Reset Link'}
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Sign In"
          onPress={() => router.replace('/sign-in')}
          style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}>
          <Text style={styles.secondaryButtonLabel}>Back to Sign In</Text>
        </Pressable>
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
    fontSize: 20,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.85,
  },
});
