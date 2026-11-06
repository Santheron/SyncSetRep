import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';
import { Link, useFocusEffect } from 'expo-router';

import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { buttonPaletteForSurface } from '@/lib/ui/button-contrast';
import { getAuthenticatedUserId } from '@/lib/current-user';
import { IMPORT_ENABLED, PERSIST_PLANNED_WEIGHT } from '@/lib/import/flags';
import {
  catalogExercisesForMatch,
  IMPORT_CATALOG_UNAVAILABLE_MESSAGE,
} from '@/lib/import/import-review-display';
import {
  IMPORT_EMPTY_SOURCE_MESSAGE,
  IMPORT_FAILED_MESSAGE,
  importWorkoutDraft,
} from '@/lib/import/import-workout';
import { OWNED_SAVE_MAX_DAYS, TEXT_MAX_CHARS } from '@/lib/import/limits';
import { parseStructuredRoutine } from '@/lib/import/structured-routine';
import { locateOwnedProgramExerciseIds, saveGuardedEquipmentTargets } from '@/lib/import/equipment-target-save';
import {
  hasCurrentProgram,
  MANUAL_SAVED_CURRENT_MESSAGE,
  MANUAL_SAVED_INACTIVE_MESSAGE,
  MANUAL_SIGN_IN_SAVE_MESSAGE,
} from '@/lib/import/manual-program';
import {
  loadExerciseCatalog,
  loadOwnedPrograms,
  saveManualProgramForCurrentUser,
  OWNED_PROGRAM_RPC_ENABLED,
} from '@/lib/import/manual-program-client';
import { runGuardedProgramSave } from '@/lib/import/one-tap-import';
import { CUSTOM_EXERCISE_WRITES_ENABLED } from '@/lib/import/planned-exercises';
import { createCustomExercise } from '@/lib/import/custom-exercise';
import { documentRoutineDraftStore } from '@/lib/import/routine-draft-file';
import {
  createRoutineSaveGate,
  resolveRoutineScreenDraft,
  ROUTINE_DRAFT_PARTIAL_TARGET_MESSAGE,
  routineDraftKey,
} from '@/lib/import/routine-draft';
import type { ImportCatalogExercise } from '@/lib/import/match-exercises';
import { pickAndReadWorkoutTextFile } from '@/lib/import/pick-text-file';
import type { ProgramReview } from '@/lib/import/review-editor';
import { TXT_FILE_UNREADABLE_MESSAGE } from '@/lib/import/text-file';

const palette = Colors.dark;
const primaryButton = buttonPaletteForSurface('dark');

export default function ImportWorkoutScreen() {
  const [source, setSource] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const [review, setReview] = useState<ProgramReview | null>(null);
  const [catalog, setCatalog] = useState<ImportCatalogExercise[]>([]);
  const [isWorking, setIsWorking] = useState(false);
  const [editsLocked, setEditsLocked] = useState(false);
  const [savedProgramId, setSavedProgramId] = useState<string | null>(null);
  const [savedAsCurrent, setSavedAsCurrent] = useState(false);
  const [saveComplete, setSaveComplete] = useState(false);
  const draftStore = useRef(documentRoutineDraftStore());
  const gateRef = useRef(createRoutineSaveGate());
  const userIdRef = useRef<string | null>(null);
  const workingRef = useRef(false);
  useFocusEffect(
    useCallback(() => {
      let mounted = true;
      void (async () => {
        const user = await getAuthenticatedUserId();
        if (!mounted || !user.ok) {
          return;
        }
        userIdRef.current = user.data;
        const key = routineDraftKey(user.data, 'import', null);
        const stored = key ? draftStore.current.read(key) : null;
        const recovered = resolveRoutineScreenDraft({
          userId: user.data,
          scope: 'import',
          programId: null,
          storedRaw: stored,
          serverReview: null,
          firstProgramRetry: true,
        });
        if (!mounted || recovered.notice == null) {
          return;
        }
        setReview(recovered.review);
        if (recovered.sourceText) {
          setSource(recovered.sourceText);
        }
        setMessages([recovered.notice]);
        setEditsLocked(recovered.editingLocked);
      })();
      return () => {
        mounted = false;
      };
    }, []),
  );

  async function catalogForSource(text: string): Promise<{
    catalog: ImportCatalogExercise[];
    warning: string | null;
  }> {
    const trimmed = text.trim();
    if (!IMPORT_ENABLED || trimmed.length === 0 || trimmed.length > TEXT_MAX_CHARS) {
      return { catalog: [], warning: null };
    }
    const loaded = await loadExerciseCatalog();
    if (!loaded.ok) {
      return { catalog: [], warning: IMPORT_CATALOG_UNAVAILABLE_MESSAGE };
    }
    return { catalog: catalogExercisesForMatch(loaded.data), warning: null };
  }

  async function readTextFile() {
    if (workingRef.current || editsLocked) {
      return;
    }
    workingRef.current = true;
    setIsWorking(true);
    setMessages([]);
    setReview(null);
    setCatalog([]);
    setSavedProgramId(null);
    try {
      const picked = await pickAndReadWorkoutTextFile();
      if (picked.canceled) {
        return;
      }
      if (!picked.result.ok) {
        setMessages([picked.result.message]);
        return;
      }
      setSource(picked.result.text);
      setReview(null);
      setSavedProgramId(null);
    } catch {
      setMessages([TXT_FILE_UNREADABLE_MESSAGE]);
    } finally {
      workingRef.current = false;
      setIsWorking(false);
    }
  }

  async function importAndSave() {
    if (workingRef.current) {
      return;
    }
    workingRef.current = true;
    setIsWorking(true);
    try {
      let nextReview = review;
      let nextCatalog = catalog;
      if (!editsLocked) {
        const trimmed = source.trim();
        if (trimmed.length === 0) {
          setReview(null);
          setMessages([IMPORT_EMPTY_SOURCE_MESSAGE]);
          return;
        }
        if (nextReview == null) {
          const prepared = await catalogForSource(source);
          const structured = parseStructuredRoutine(source);
          if (structured) {
            nextReview = structured;
            setReview(nextReview);
            if (prepared.warning) {
              setCatalog([]);
              setMessages([prepared.warning]);
              return;
            }
            nextCatalog = prepared.catalog;
            setCatalog(nextCatalog);
          } else {
            const imported = await importWorkoutDraft(source, { catalog: prepared.catalog });
            if (!imported.ok) {
              setCatalog([]);
              setMessages(imported.errors);
              return;
            }
            nextReview = imported.review;
            setReview(nextReview);
            if (prepared.warning) {
              setCatalog([]);
              setMessages([prepared.warning]);
              return;
            }
            nextCatalog = prepared.catalog;
            setCatalog(nextCatalog);
          }
        } else {
          const prepared = await catalogForSource(source);
          if (prepared.warning) {
            setCatalog([]);
            setMessages([prepared.warning]);
            return;
          }
          nextCatalog = prepared.catalog;
          setCatalog(nextCatalog);
        }
      }
      if (nextReview == null) {
        setMessages([IMPORT_EMPTY_SOURCE_MESSAGE]);
        return;
      }
      const user = await getAuthenticatedUserId();
      if (!user.ok || user.data.trim() === '') {
        setMessages([MANUAL_SIGN_IN_SAVE_MESSAGE]);
        return;
      }
      const programs = await loadOwnedPrograms();
      if (!programs.ok) {
        setMessages([programs.error]);
        return;
      }
      const userId = user.data;
      userIdRef.current = userId;
      const draftKey = routineDraftKey(userId, 'import', null);
      const storedRaw = draftKey ? draftStore.current.read(draftKey) : null;
      const hadCurrent = hasCurrentProgram(programs.data);
      const result = await runGuardedProgramSave({
        mode: 'import',
        review: nextReview,
        catalog: nextCatalog,
        gate: gateRef.current,
        store: draftStore.current,
        userId,
        scope: 'import',
        programId: null,
        programsLoaded: true,
        hasCurrentProgram: hadCurrent,
        storedRaw,
        sourceText: source,
        ownedProgramRpcEnabled: OWNED_PROGRAM_RPC_ENABLED,
        customWritesEnabled: CUSTOM_EXERCISE_WRITES_ENABLED,
        persistTargets: PERSIST_PLANNED_WEIGHT,
        createCustom: (name) => createCustomExercise(name),
        saveProgram: (next, clientRequestId) =>
          saveManualProgramForCurrentUser(next, {
            clientRequestId,
            persistPlannedWeight: PERSIST_PLANNED_WEIGHT,
            subtitleRequired: false,
            allowUnspecifiedPrescription: true,
            maxDays: OWNED_SAVE_MAX_DAYS,
          }),
        locateSavedRows: (programId) => locateOwnedProgramExerciseIds(programId),
        saveTargets: (programId, next, savedRows) => saveGuardedEquipmentTargets(programId, next, savedRows),
      });
      setReview(result.review);
      setEditsLocked(result.editingLocked);
      if (result.status === 'skipped') {
        return;
      }
      if (result.status === 'saved' && result.programId) {
        setSavedProgramId(result.programId);
        setSavedAsCurrent(!hadCurrent);
        setSaveComplete(true);
        setMessages([
          !hadCurrent ? MANUAL_SAVED_CURRENT_MESSAGE : MANUAL_SAVED_INACTIVE_MESSAGE,
          `Saved id ${result.programId}. Workout history was not changed.`,
        ]);
      } else if (result.status === 'partial' && result.programId) {
        setSavedProgramId(result.programId);
        setSavedAsCurrent(false);
        setMessages([...result.errors, ROUTINE_DRAFT_PARTIAL_TARGET_MESSAGE]);
      } else if (result.status === 'failed') {
        setSavedProgramId(null);
        setSavedAsCurrent(false);
        setSaveComplete(false);
        setMessages(result.errors);
      }
    } catch {
      setSavedProgramId(null);
      setSavedAsCurrent(false);
      setSaveComplete(false);
      setMessages([IMPORT_FAILED_MESSAGE]);
    } finally {
      workingRef.current = false;
      setIsWorking(false);
    }
  }

  return (
    <Screen>
      <Text style={styles.title}>Import a workout</Text>
      <Text style={styles.body}>
        Paste one week or choose a .txt file, then import and save. Known exercises match
        automatically. Any other name is kept and saved as your exercise. Missing sets or reps
        are kept and filled in when that exercise comes up. Saving does not change workout history.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Choose a .txt file"
        disabled={isWorking || editsLocked}
        onPress={() => {
          void readTextFile();
        }}
        style={styles.secondary}>
        <Text style={styles.secondaryLabel}>{isWorking ? 'Working...' : 'Choose a .txt file'}</Text>
      </Pressable>
      <TextInput
        accessibilityLabel="Workout text"
        multiline
        editable={!editsLocked}
        onChangeText={(value) => {
          setSource(value);
          if (!editsLocked) {
            setReview(null);
            setSavedProgramId(null);
            setSavedAsCurrent(false);
            setSaveComplete(false);
          }
        }}
        placeholder="Paste one week of a workout"
        placeholderTextColor={palette.muted}
        style={styles.input}
        value={source}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Import & Save Routine"
        disabled={isWorking}
        onPress={() => {
          void importAndSave();
        }}
        style={styles.button}>
        <Text style={styles.buttonLabel}>{isWorking ? 'Working...' : 'Import & Save Routine'}</Text>
      </Pressable>
      {messages.map((message) => (
        <Text key={message} style={styles.body}>
          {message}
        </Text>
      ))}
      {saveComplete && savedProgramId && savedAsCurrent ? (
        <>
          <Link href="/program" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="Open this routine" style={styles.secondary}>
              <Text style={styles.secondaryLabel}>Open this routine</Text>
            </Pressable>
          </Link>
          <Link href="/workout/select" asChild>
            <Pressable accessibilityRole="button" accessibilityLabel="Start workout" style={styles.secondary}>
              <Text style={styles.secondaryLabel}>Start workout</Text>
            </Pressable>
          </Link>
        </>
      ) : null}
      {savedProgramId && !savedAsCurrent ? (
        <Link href="/program/saved" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel="Open saved routines" style={styles.secondary}>
            <Text style={styles.secondaryLabel}>Open saved routines</Text>
          </Pressable>
        </Link>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  title: {
    color: palette.text,
    fontSize: 32,
    fontWeight: '800',
  },
  body: {
    color: palette.text,
    fontSize: 16,
  },
  input: {
    minHeight: 160,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    color: palette.text,
    fontSize: 16,
    padding: 16,
    textAlignVertical: 'top',
  },
  button: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: primaryButton.background,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  buttonLabel: {
    color: primaryButton.label,
    fontSize: 16,
    fontWeight: '700',
  },
  secondary: {
    minHeight: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  secondaryLabel: {
    color: palette.text,
    fontSize: 16,
    fontWeight: '700',
  },
  disabledSave: {
    opacity: 0.45,
  },
});
