import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { SavedProgramList } from '@/components/saved-program-list';
import {
  activateOwnedProgramForCurrentUser,
  loadOwnedPrograms,
} from '@/lib/import/manual-program-client';
import { requestProgramSwitch, type SavedProgramSummary } from '@/lib/import/manual-program';

export default function SavedProgramsScreen() {
  const [programs, setPrograms] = useState<SavedProgramSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [isSwitching, setIsSwitching] = useState(false);
  const switchLock = useRef(false);

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

  async function confirmSwitch(programId: string) {
    if (switchLock.current) {
      return;
    }
    const decision = requestProgramSwitch(programs, programId);
    if (!decision.ok) {
      setSwitchError(decision.error);
      return;
    }
    switchLock.current = true;
    setIsSwitching(true);
    setSwitchError(null);
    const result = await activateOwnedProgramForCurrentUser(programId);
    if (!result.ok) {
      switchLock.current = false;
      setIsSwitching(false);
      setSwitchError(result.error);
      return;
    }
    const loaded = await loadOwnedPrograms();
    switchLock.current = false;
    setIsSwitching(false);
    if (!loaded.ok) {
      setSwitchError(loaded.error);
      return;
    }
    setPrograms(loaded.data);
    setSwitchError(null);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <SavedProgramList
        errorMessage={errorMessage}
        isLoading={isLoading}
        isSwitching={isSwitching}
        onConfirmSwitch={(programId) => {
          void confirmSwitch(programId);
        }}
        programs={programs}
        switchError={switchError}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
