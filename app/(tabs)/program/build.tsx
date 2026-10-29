import { useCallback, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { ManualProgramBuilder } from '@/components/manual-program-builder';
import {
  loadExerciseCatalog,
  loadOwnedPrograms,
  saveManualProgramForCurrentUser,
} from '@/lib/import/manual-program-client';
import {
  hasCurrentProgram,
  type CatalogExercise,
  type SavedProgramSummary,
} from '@/lib/import/manual-program';
import { createManualProgramReview, type ProgramReview } from '@/lib/import/review-editor';

export default function BuildRoutineScreen() {
  const [review, setReview] = useState<ProgramReview>(createManualProgramReview);
  const [programs, setPrograms] = useState<SavedProgramSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [savedProgramId, setSavedProgramId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [programsLoaded, setProgramsLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function load() {
        const [programResult, catalogResult] = await Promise.all([
          loadOwnedPrograms(),
          loadExerciseCatalog(),
        ]);
        if (!isMounted) {
          return;
        }
        if (!programResult.ok) {
          setLoadError(programResult.error);
          setPrograms([]);
        } else {
          setLoadError(null);
          setPrograms(programResult.data);
        }
        if (catalogResult.ok) {
          setCatalog(catalogResult.data);
        } else if (programResult.ok) {
          setLoadError(catalogResult.error);
        }
        setProgramsLoaded(true);
      }

      void load();
      return () => {
        isMounted = false;
      };
    }, []),
  );

  async function save() {
    if (isSaving || !programsLoaded) {
      return;
    }
    setIsSaving(true);
    setSaveErrors([]);
    const result = await saveManualProgramForCurrentUser(review);
    if (!result.ok) {
      setSaveErrors(result.errors);
      setSavedProgramId(null);
    } else {
      setSavedProgramId(result.programId);
    }
    setIsSaving(false);
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <ManualProgramBuilder
        catalog={catalog}
        hasActiveProgram={!programsLoaded || loadError != null || hasCurrentProgram(programs)}
        isSaving={isSaving}
        onChange={setReview}
        onSave={() => {
          void save();
        }}
        review={review}
        saveErrors={loadError ? [loadError, ...saveErrors] : saveErrors}
        savedProgramId={savedProgramId}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
});
