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

export default function SignUpScreen() {
  const router = useRouter();
  const { signUp } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit() {
    if (isSubmitting) {
      return;
    }

    if (!email.trim() || !password) {
      setErrorMessage('Enter an email and password.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters.');
      return;
    }

    if (password !== confirmPassword) {
      setErrorMessage('Passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setInfoMessage(null);

    const result = await signUp(email, password);

    if (result.error) {
      setErrorMessage(result.error);
      setIsSubmitting(false);
      return;
    }

    if (result.needsConfirmation) {
      setInfoMessage(
        'Check your email to confirm your account. Open the confirmation link on this phone to finish signing in.',
      );
      setIsSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <Screen keyboardShouldPersistTaps="handled">
        <Text style={styles.kicker}>Workout Tracker</Text>
        <Text style={styles.title}>Sign Up</Text>
        <Text style={styles.subtitle}>Create an account to keep your workouts private.</Text>

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
            placeholder="At least 6 characters"
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
        {infoMessage ? <Text style={styles.info}>{infoMessage}</Text> : null}

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
