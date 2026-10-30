import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ManualProgramBuilder } from '@/components/manual-program-builder';
import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import {
  loadExerciseCatalog,
  loadOwnedPrograms,
  loadProgramDraftForCurrentUser,
  saveManualProgramForCurrentUser,
  saveOwnedProgramEditForCurrentUser,
} from '@/lib/import/manual-program-client';
import {
  hasCurrentProgram,
  type CatalogExercise,
  type SavedProgramSummary,
} from '@/lib/import/manual-program';
import { createCustomExercise } from '@/lib/import/custom-exercise';
import {
  DRAFT_LOADING_MESSAGE,
  reviewFromProgramDraft,
} from '@/lib/import/program-draft';
import {
  createManualProgramReview,
  type ProgramReview,
} from '@/lib/import/review-editor';

const palette = Colors.dark;

function firstParam(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value;
  const trimmed = raw?.trim() ?? '';
  return trimmed === '' ? undefined : trimmed;
}

export default function BuildRoutineScreen() {
  const params = useLocalSearchParams<{ programId?: string | string[]; dayId?: string | string[] }>();
  const programId = firstParam(params.programId);
  const dayId = firstParam(params.dayId);
  const editingRequested = programId != null || dayId != null;
  const draftKey = `${programId ?? ''}:${dayId ?? ''}`;
  const loadedDraftKey = useRef<string | null>(null);
  const [review, setReview] = useState<ProgramReview>(createManualProgramReview);
  const [programs, setPrograms] = useState<SavedProgramSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [savedProgramId, setSavedProgramId] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const saveLock = useRef(false);
  const [programsLoaded, setProgramsLoaded] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftUserId, setDraftUserId] = useState<string | null>(null);
  const [draftProgramId, setDraftProgramId] = useState<string | null>(null);
  const [focusDayIndex, setFocusDayIndex] = useState<number | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      async function load() {
        const [programResult, catalogResult, draftResult] = await Promise.all([
          loadOwnedPrograms(),
          loadExerciseCatalog(),
          editingRequested
            ? loadProgramDraftForCurrentUser({ programId, dayId })
            : Promise.resolve(null),
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
        if (!editingRequested) {
          if (loadedDraftKey.current != null) {
            setReview(createManualProgramReview());
            setDraftUserId(null);
            setDraftProgramId(null);
            setFocusDayIndex(null);
            loadedDraftKey.current = null;
          }
          setDraftReady(false);
        } else if (draftResult && loadedDraftKey.current !== draftKey) {
          if (!draftResult.ok) {
            setLoadError(draftResult.error);
            setDraftReady(false);
            setDraftUserId(null);
            setDraftProgramId(null);
          } else {
            setReview(reviewFromProgramDraft(draftResult.draft));
            setDraftUserId(draftResult.userId);
            setDraftProgramId(draftResult.draft.programId);
            setFocusDayIndex(draftResult.focusDayIndex);
            setDraftReady(true);
            setSaveErrors([]);
            setSavedProgramId(null);
            loadedDraftKey.current = draftKey;
          }
        }
        setProgramsLoaded(true);
      }

      void load();
      return () => {
        isMounted = false;
      };
    }, [dayId, draftKey, editingRequested, programId]),
  );

  function save() {
    if (editingRequested) {
      void saveEditedRoutine();
      return;
    }
    void saveNewRoutine();
  }

  async function saveEditedRoutine() {
    if (saveLock.current || isSaving) {
      return;
    }
    if (!draftReady || !draftUserId || !draftProgramId) {
      setSaveErrors([DRAFT_LOADING_MESSAGE]);
      return;
    }
    saveLock.current = true;
    setIsSaving(true);
    setSaveErrors([]);
    const result = await saveOwnedProgramEditForCurrentUser(review, { programId: draftProgramId });
    if (!result.ok) {
      saveLock.current = false;
      setSaveErrors(result.errors);
    } else {
      setSaveErrors([]);
      setSavedProgramId(result.programId);
    }
    setIsSaving(false);
  }

  async function saveNewRoutine() {
    if (saveLock.current || isSaving || !programsLoaded || savedProgramId) {
      return;
    }
    saveLock.current = true;
    setIsSaving(true);
    setSaveErrors([]);
    const result = await saveManualProgramForCurrentUser(review);
    if (!result.ok) {
      saveLock.current = false;
      setSaveErrors(result.errors);
      setSavedProgramId(null);
    } else {
      setSavedProgramId(result.programId);
    }
    setIsSaving(false);
  }

  if (editingRequested && !draftReady) {
    return (
      <Screen>
        <Text style={styles.loading}>{loadError ?? DRAFT_LOADING_MESSAGE}</Text>
      </Screen>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.flex}>
      <ManualProgramBuilder
        catalog={catalog}
        editing={editingRequested && draftReady}
        focusDayIndex={focusDayIndex}
        hasActiveProgram={!programsLoaded || loadError != null || hasCurrentProgram(programs)}
        isSaving={isSaving}
        onChange={setReview}
        onSave={save}
        onSaveCustomExercise={(name) => {
          void createCustomExercise(name).then((result) => {
            if (!result.ok) {
              setSaveErrors([result.error]);
              return;
            }
            setSaveErrors([]);
          });
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
  loading: {
    color: palette.text,
    fontSize: 16,
  },
});
