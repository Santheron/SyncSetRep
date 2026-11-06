import { useCallback, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';

import { ManualProgramBuilder } from '@/components/manual-program-builder';
import { Screen } from '@/components/screen';
import { Colors } from '@/constants/theme';
import { getAuthenticatedUserId } from '@/lib/current-user';
import {
  loadExerciseCatalog,
  loadOwnedPrograms,
  loadProgramDraftForCurrentUser,
  OWNED_PROGRAM_RPC_ENABLED,
  saveManualProgramForCurrentUser,
  saveOwnedProgramEditForCurrentUser,
} from '@/lib/import/manual-program-client';
import {
  hasCurrentProgram,
  type CatalogExercise,
  type SavedProgramSummary,
} from '@/lib/import/manual-program';
import { createCustomExercise } from '@/lib/import/custom-exercise';
import { locateOwnedProgramExerciseIds, saveGuardedEquipmentTargets } from '@/lib/import/equipment-target-save';
import { PERSIST_PLANNED_WEIGHT } from '@/lib/import/flags';
import { runGuardedProgramSave } from '@/lib/import/one-tap-import';
import { CUSTOM_EXERCISE_WRITES_ENABLED } from '@/lib/import/planned-exercises';
import {
  DRAFT_LOADING_MESSAGE,
  reviewFromProgramDraft,
} from '@/lib/import/program-draft';
import {
  createRoutineSaveGate,
  resolveRoutineScreenDraft,
  ROUTINE_DRAFT_PARTIAL_TARGET_MESSAGE,
  routineDraftKey,
  storeRoutineReview,
  type RoutineDraftScope,
  type RoutineSaveGate,
} from '@/lib/import/routine-draft';
import { documentRoutineDraftStore } from '@/lib/import/routine-draft-file';
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
  const routeKey = editingRequested ? `edit:${programId ?? ''}:${dayId ?? ''}` : 'new';
  const loadedRouteKey = useRef<string | null>(null);
  const draftStore = useRef(documentRoutineDraftStore());
  const gateRef = useRef<RoutineSaveGate>(createRoutineSaveGate());
  const saveGeneration = useRef(0);
  const acceptEdits = useRef(false);
  const editsLockedRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const scopeRef = useRef<RoutineDraftScope>(editingRequested ? 'edit' : 'new');
  const programKeyRef = useRef<string | null>(null);
  const serverReviewRef = useRef<ProgramReview | null>(null);
  const [review, setReview] = useState<ProgramReview>(createManualProgramReview);
  const reviewRef = useRef(review);
  const [programs, setPrograms] = useState<SavedProgramSummary[]>([]);
  const [catalog, setCatalog] = useState<CatalogExercise[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<string[]>([]);
  const [recoveryNotice, setRecoveryNotice] = useState<string | null>(null);
  const [editsLocked, setEditsLocked] = useState(false);
  const [savedProgramId, setSavedProgramId] = useState<string | null>(null);
  const [savedIsCurrent, setSavedIsCurrent] = useState<boolean | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [programsLoaded, setProgramsLoaded] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [draftUserId, setDraftUserId] = useState<string | null>(null);
  const [draftProgramId, setDraftProgramId] = useState<string | null>(null);
  const [focusDayIndex, setFocusDayIndex] = useState<number | null>(null);
  const [localReady, setLocalReady] = useState(false);

  function replaceReview(next: ProgramReview) {
    reviewRef.current = next;
    setReview(next);
  }

  function setRecoveryLock(locked: boolean) {
    editsLockedRef.current = locked;
    setEditsLocked(locked);
  }

  function persistReview(
    next: ProgramReview,
    saveState: 'editing' | 'saving',
    saveRequestId?: string | null,
  ) {
    const userId = userIdRef.current;
    if (!userId || gateRef.current.confirmedProgramId != null) {
      return;
    }
    storeRoutineReview({
      store: draftStore.current,
      userId,
      scope: scopeRef.current,
      programId: programKeyRef.current,
      review: next,
      saveState,
      serverReview: serverReviewRef.current,
      saveRequestId,
    });
  }

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;
      if (loadedRouteKey.current !== routeKey) {
        acceptEdits.current = false;
      }
      const scope: RoutineDraftScope = editingRequested ? 'edit' : 'new';
      scopeRef.current = scope;

      async function load() {
        const [programResult, catalogResult, draftResult, userResult] = await Promise.all([
          loadOwnedPrograms(),
          loadExerciseCatalog(),
          editingRequested
            ? loadProgramDraftForCurrentUser({ programId, dayId })
            : Promise.resolve(null),
          getAuthenticatedUserId(),
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
        userIdRef.current = userResult.ok ? userResult.data : null;
        const alreadyShowing = loadedRouteKey.current === routeKey;
        if (!alreadyShowing) {
          saveGeneration.current += 1;
          gateRef.current = createRoutineSaveGate();
          setSavedProgramId(null);
          setSaveErrors([]);
          setIsSaving(false);
          setRecoveryNotice(null);
          setRecoveryLock(false);
        }

        if (!editingRequested) {
          programKeyRef.current = null;
          serverReviewRef.current = null;
          setDraftUserId(null);
          setDraftProgramId(null);
          setFocusDayIndex(null);
          setDraftReady(false);
          if (!alreadyShowing) {
            const key = userResult.ok ? routineDraftKey(userResult.data, 'new', null) : null;
            const resolved = userResult.ok
              ? resolveRoutineScreenDraft({
                  userId: userResult.data,
                  scope: 'new',
                  programId: null,
                  storedRaw: key ? draftStore.current.read(key) : null,
                  serverReview: null,
                  firstProgramRetry:
                    OWNED_PROGRAM_RPC_ENABLED && programResult.ok && !hasCurrentProgram(programResult.data),
                })
              : { review: createManualProgramReview(), notice: null, dropStored: false, editingLocked: false };
            if (resolved.dropStored && key) {
              draftStore.current.delete(key);
            }
            replaceReview(resolved.review);
            setRecoveryNotice(resolved.notice);
            setRecoveryLock(resolved.editingLocked === true);
          } else if (userResult.ok) {
            const key = routineDraftKey(userResult.data, 'new', null);
            const resolved = resolveRoutineScreenDraft({
              userId: userResult.data,
              scope: 'new',
              programId: null,
              storedRaw: key ? draftStore.current.read(key) : null,
              serverReview: null,
              firstProgramRetry:
                OWNED_PROGRAM_RPC_ENABLED && programResult.ok && !hasCurrentProgram(programResult.data),
            });
            if (resolved.editingLocked) {
              replaceReview(resolved.review);
              setRecoveryNotice(resolved.notice);
              setRecoveryLock(true);
            }
          }
          loadedRouteKey.current = routeKey;
          acceptEdits.current = gateRef.current.confirmedProgramId == null && !editsLockedRef.current;
          setLocalReady(true);
        } else if (draftResult && loadedRouteKey.current !== routeKey) {
          if (!draftResult.ok) {
            setLoadError(draftResult.error);
            setDraftReady(false);
            setDraftUserId(null);
            setDraftProgramId(null);
            serverReviewRef.current = null;
            programKeyRef.current = null;
            setLocalReady(true);
          } else {
            const serverReview = reviewFromProgramDraft(draftResult.draft);
            const storedProgramId = draftResult.draft.programId;
            serverReviewRef.current = serverReview;
            programKeyRef.current = storedProgramId;
            const key = userResult.ok ? routineDraftKey(userResult.data, 'edit', storedProgramId) : null;
            const resolved = userResult.ok
              ? resolveRoutineScreenDraft({
                  userId: userResult.data,
                  scope: 'edit',
                  programId: storedProgramId,
                  storedRaw: key ? draftStore.current.read(key) : null,
                  serverReview,
                })
              : { review: serverReview, notice: null, dropStored: false, editingLocked: false };
            if (resolved.dropStored && key) {
              draftStore.current.delete(key);
            }
            replaceReview(resolved.review);
            setRecoveryNotice(resolved.notice);
            setRecoveryLock(resolved.editingLocked === true);
            setDraftUserId(draftResult.userId);
            setDraftProgramId(storedProgramId);
            setFocusDayIndex(draftResult.focusDayIndex);
            setDraftReady(true);
            setSaveErrors([]);
            loadedRouteKey.current = routeKey;
            acceptEdits.current = !editsLockedRef.current;
            setLocalReady(true);
          }
        } else if (draftResult?.ok) {
          if (userResult.ok && programKeyRef.current) {
            const key = routineDraftKey(userResult.data, 'edit', programKeyRef.current);
            const resolved = resolveRoutineScreenDraft({
              userId: userResult.data,
              scope: 'edit',
              programId: programKeyRef.current,
              storedRaw: key ? draftStore.current.read(key) : null,
              serverReview: serverReviewRef.current,
            });
            if (resolved.editingLocked) {
              replaceReview(resolved.review);
              setRecoveryNotice(resolved.notice);
              setRecoveryLock(true);
            }
          }
          acceptEdits.current = gateRef.current.confirmedProgramId == null && !editsLockedRef.current;
          setLocalReady(true);
        }
        setProgramsLoaded(true);
      }

      void load();
      return () => {
        isMounted = false;
      };
    }, [dayId, editingRequested, programId, routeKey]),
  );

  function changeReview(next: ProgramReview) {
    if (editsLockedRef.current) {
      return;
    }
    replaceReview(next);
    if (!acceptEdits.current) {
      return;
    }
    persistReview(next, 'editing');
  }

  function save() {
    if (editingRequested) {
      void saveEditedRoutine();
      return;
    }
    void saveNewRoutine();
  }

  function catalogForSave() {
    return catalog.map((item) => ({
      id: item.id,
      name: item.name,
      equipment_type: item.equipment ?? null,
    }));
  }

  async function saveEditedRoutine() {
    const generation = saveGeneration.current;
    if (!draftReady || !draftUserId || !draftProgramId) {
      setSaveErrors([DRAFT_LOADING_MESSAGE]);
      return;
    }
    const reviewAtSave = reviewRef.current;
    const userId = userIdRef.current;
    const programAtSave = programKeyRef.current ?? draftProgramId;
    const draftKey = userId ? routineDraftKey(userId, 'edit', programAtSave) : null;
    const storedRaw = draftKey ? draftStore.current.read(draftKey) : null;
    setIsSaving(true);
    setSaveErrors([]);
    const result = await runGuardedProgramSave({
      mode: 'manual',
      review: reviewAtSave,
      catalog: catalogForSave(),
      gate: gateRef.current,
      store: draftStore.current,
      userId,
      scope: 'edit',
      programId: programAtSave,
      programsLoaded: true,
      hasCurrentProgram: true,
      storedRaw,
      ownedProgramRpcEnabled: OWNED_PROGRAM_RPC_ENABLED,
      customWritesEnabled: CUSTOM_EXERCISE_WRITES_ENABLED,
      persistTargets: PERSIST_PLANNED_WEIGHT,
      createCustom: (name) => createCustomExercise(name),
      saveProgram: (next) => saveOwnedProgramEditForCurrentUser(next, { programId: programAtSave }),
      locateSavedRows: (programId) => locateOwnedProgramExerciseIds(programId),
      saveTargets: (programId, next, savedRows) => saveGuardedEquipmentTargets(programId, next, savedRows),
    });
    if (generation !== saveGeneration.current) {
      return;
    }
    replaceReview(result.review);
    if (result.status === 'saved' && result.programId) {
      setSaveErrors([]);
      setRecoveryNotice(null);
      setSavedProgramId(result.programId);
      setRecoveryLock(false);
      acceptEdits.current = false;
    } else if (result.status === 'partial') {
      setSaveErrors(result.errors);
      setSavedProgramId(null);
      setRecoveryNotice(ROUTINE_DRAFT_PARTIAL_TARGET_MESSAGE);
      setRecoveryLock(true);
      acceptEdits.current = false;
    } else if (result.status !== 'skipped') {
      setSaveErrors(result.errors);
      setSavedProgramId(null);
      setRecoveryLock(false);
    }
    setIsSaving(false);
  }

  async function saveNewRoutine() {
    const generation = saveGeneration.current;
    if (!programsLoaded) {
      return;
    }
    const reviewAtSave = reviewRef.current;
    const userId = userIdRef.current;
    const draftKey = userId ? routineDraftKey(userId, 'new', null) : null;
    const storedRaw = draftKey ? draftStore.current.read(draftKey) : null;
    setIsSaving(true);
    setSaveErrors([]);
    const result = await runGuardedProgramSave({
      mode: 'manual',
      review: reviewAtSave,
      catalog: catalogForSave(),
      gate: gateRef.current,
      store: draftStore.current,
      userId,
      scope: 'new',
      programId: null,
      programsLoaded: true,
      hasCurrentProgram: hasCurrentProgram(programs),
      storedRaw,
      ownedProgramRpcEnabled: OWNED_PROGRAM_RPC_ENABLED,
      customWritesEnabled: CUSTOM_EXERCISE_WRITES_ENABLED,
      persistTargets: PERSIST_PLANNED_WEIGHT,
      createCustom: (name) => createCustomExercise(name),
      saveProgram: (next, clientRequestId) =>
        saveManualProgramForCurrentUser(next, { clientRequestId }),
      locateSavedRows: (programId) => locateOwnedProgramExerciseIds(programId),
      saveTargets: (programId, next, savedRows) => saveGuardedEquipmentTargets(programId, next, savedRows),
    });
    if (generation !== saveGeneration.current) {
      return;
    }
    replaceReview(result.review);
    if (result.status === 'saved' && result.programId) {
      setRecoveryNotice(null);
      setSavedProgramId(result.programId);
      const current = programs.find((program) => program.isActive);
      setSavedIsCurrent(current == null || current.id === result.programId);
      setRecoveryLock(false);
      acceptEdits.current = false;
    } else if (result.status === 'partial') {
      setSaveErrors(result.errors);
      setSavedProgramId(null);
      setRecoveryNotice(ROUTINE_DRAFT_PARTIAL_TARGET_MESSAGE);
      setRecoveryLock(true);
      acceptEdits.current = false;
    } else if (result.status !== 'skipped') {
      setSaveErrors(result.errors);
      setSavedProgramId(null);
      setRecoveryLock(false);
    }
    setIsSaving(false);
  }

  if (!localReady || (editingRequested && !draftReady)) {
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
        onChange={changeReview}
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
        editsLocked={editsLocked}
        recoveryNotice={savedProgramId ? null : recoveryNotice}
        review={review}
        savedIsCurrent={savedIsCurrent}
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
