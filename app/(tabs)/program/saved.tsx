import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { SavedProgramList } from '@/components/saved-program-list';
import { loadOwnedPrograms } from '@/lib/import/manual-program-client';
import type { SavedProgramSummary } from '@/lib/import/manual-program';

export default function SavedProgramsScreen() {
  const [programs, setPrograms] = useState<SavedProgramSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function load() {
        setIsLoading(true);
        const result = await loadOwnedPrograms();
        if (!isMounted) {
          return;
        }
        if (!result.ok) {
          setPrograms([]);
          setErrorMessage(result.error);
        } else {
          setPrograms(result.data);
          setErrorMessage(null);
        }
        setIsLoading(false);
      }

      void load();
      return () => {
        isMounted = false;
      };
    }, []),
  );

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <SavedProgramList errorMessage={errorMessage} isLoading={isLoading} programs={programs} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
