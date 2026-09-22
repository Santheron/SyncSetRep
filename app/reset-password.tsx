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

export default function ResetPasswordScreen() {
  const router = useRouter();
  const { session, signOut, updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    if (isSubmitting) {
      return;
    }

    if (!session) {
      setErrorMessage('This reset link has expired. Request a new one from Sign In.');
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

    const result = await updatePassword(password);

    if (result.error) {
      setErrorMessage(result.error);
      setIsSubmitting(false);
      return;
    }

    router.replace({
      pathname: '/sign-in',
      params: { passwordUpdated: '1' },
    });
  }

  async function cancel() {
    await signOut();
    router.replace('/sign-in');
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <Screen keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>SyncSetRep</Text>
        <Text style={styles.title}>Set New Password</Text>
        <Text style={styles.subtitle}>
          {session
            ? 'Choose a new password for your account.'
            : 'This reset link is missing a valid session. Request a new one.'}
        </Text>

        {session ? (
          <>
            <View style={styles.field}>
              <Text style={styles.fieldLabel}>New password</Text>
              <TextInput
                accessibilityLabel="New password"
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
          </>
        ) : null}

        {errorMessage ? <Text style={styles.error}>{errorMessage}</Text> : null}

        {session ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Save new password"
            disabled={isSubmitting}
            onPress={() => {
              void submit();
            }}
            style={({ pressed }) => [
              styles.primaryButton,
              (pressed || isSubmitting) && styles.pressed,
            ]}>
            <Text style={styles.primaryButtonLabel}>
              {isSubmitting ? 'Saving...' : 'Save Password'}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to Sign In"
          onPress={() => {
            void cancel();
          }}
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
