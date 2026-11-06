import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const layoutPath = join(root, 'app', '_layout.tsx');
const routePath = join(root, 'app', 'local-validation.tsx');
const port = 8091;
const stubPort = 55449;
const debugPort = 9223;
const times = '×';

const routeSource = `import { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { ImportReview } from '@/components/import-review';
import { ManualProgramBuilder } from '@/components/manual-program-builder';
import ImportWorkoutScreen from './(tabs)/program/import';
import { historySetDisplayLine, historySetTracking } from '@/lib/history-sets';
import { importReviewSaveBlockers } from '@/lib/import/import-review-display';
import { programReviewFromImport } from '@/lib/import/review-from-import';
import { createManualProgramReview } from '@/lib/import/review-editor';

const importedReview = programReviewFromImport(
  {
    programName: { origin: 'extracted', value: 'Resistance Training Program' },
    warnings: [],
    issues: [],
    days: [
      {
        name: { origin: 'extracted', value: 'Day 1' },
        subtitle: { origin: 'missing', value: null },
        exercises: [
          {
            sourceName: 'Bench Press',
            sets: { origin: 'extracted', value: 3, suggestion: null },
            repsMin: { origin: 'extracted', value: 8, suggestion: null },
            repsMax: { origin: 'extracted', value: 8, suggestion: null },
            restSeconds: { origin: 'extracted', value: 90, suggestion: null },
            weight: { origin: 'extracted', value: 135, suggestion: null },
            notes: { origin: 'missing', value: null },
          },
          {
            sourceName: 'Shoulder Press',
            sets: { origin: 'extracted', value: 3, suggestion: null },
            repsMin: { origin: 'extracted', value: 10, suggestion: null },
            repsMax: { origin: 'extracted', value: 10, suggestion: null },
            restSeconds: { origin: 'missing', value: null, suggestion: null },
            weight: { origin: 'missing', value: null, suggestion: null },
            notes: { origin: 'missing', value: null },
          },
        ],
      },
    ],
  },
  [
    [
      { status: 'matched', selectedId: '4' },
      { status: 'ambiguous', selectedId: null },
    ],
  ],
);

const reviewCatalog = [
  { id: '4', name: 'Bench Press', equipment_type: 'barbell' },
  { id: '8', name: 'Dumbbell Shoulder Press', equipment_type: 'dumbbell' },
  { id: '9', name: 'Barbell Shoulder Press', equipment_type: 'barbell' },
];

function ReviewFixture() {
  const [review, setReview] = useState(importedReview);
  const [draftValid, setDraftValid] = useState(true);
  const [savePresses, setSavePresses] = useState(0);
  const canSave = draftValid && importReviewSaveBlockers(review).length === 0;
  return (
    <View accessibilityLabel="Import review fixture">
      <Text accessibilityLabel="Import draft save state">{canSave ? 'enabled' : 'disabled'}</Text>
      <Text accessibilityLabel="Import draft save presses">{String(savePresses)}</Text>
      <ImportReview
        catalog={reviewCatalog}
        onChange={setReview}
        onDraftValid={setDraftValid}
        review={review}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Save reviewed import draft"
        accessibilityState={{ disabled: !canSave }}
        disabled={!canSave}
        onPress={() => {
          if (!canSave) {
            return;
          }
          setSavePresses((count) => count + 1);
        }}>
        <Text>Save reviewed import draft</Text>
      </Pressable>
    </View>
  );
}

function RoutineBuilderFixture() {
  const [review, setReview] = useState(createManualProgramReview());
  const [isSaving, setIsSaving] = useState(false);
  const [presses, setPresses] = useState(0);
  const savingRef = useRef(false);
  return (
    <View accessibilityLabel="Routine builder fixture">
      <Text accessibilityLabel="Routine save presses">{String(presses)}</Text>
      <ManualProgramBuilder
        catalog={[{ id: '4', name: 'Bench Press' }]}
        hasActiveProgram={false}
        isSaving={isSaving}
        onChange={setReview}
        onSave={() => {
          if (savingRef.current) {
            return;
          }
          savingRef.current = true;
          setPresses((count) => count + 1);
          setIsSaving(true);
        }}
        review={review}
        saveErrors={[]}
        savedProgramId={null}
      />
    </View>
  );
}

const samples = [
  {
    label: 'history-bodyweight',
    expected: 'BW ${times} 8',
    row: { weight: null, reps: 8, load_mode: 'bodyweight', assistance: null, weight_unit: 'lb' },
  },
  {
    label: 'history-added',
    expected: 'BW + 25 lb ${times} 5',
    row: { weight: 25, reps: 5, load_mode: 'added', assistance: null, weight_unit: 'lb' },
  },
  {
    label: 'history-assisted',
    expected: 'Assisted 20 lb ${times} 6',
    row: { weight: null, reps: 6, load_mode: 'assisted', assistance: 20, weight_unit: 'lb' },
  },
  {
    label: 'history-legacy',
    expected: '135 lb ${times} 5',
    row: { weight: 135, reps: 5, load_mode: null, assistance: null, weight_unit: null },
  },
];

export default function LocalValidationScreen() {
  return (
    <View>
      {samples.map((sample) => {
        const tracking = historySetTracking(sample.row);
        return (
          <Text key={sample.label} accessibilityLabel={sample.label}>
            {historySetDisplayLine({
              weight: sample.row.weight,
              reps: sample.row.reps,
              loadMode: tracking.loadMode,
              assistance: tracking.assistance,
              weightUnit: tracking.weightUnit,
            })}
          </Text>
        );
      })}
      <ImportWorkoutScreen />
      <ReviewFixture />
      <RoutineBuilderFixture />
    </View>
  );
}
`;

function browserPath(): string {
  const candidates = [
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  ];
  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error('Edge or Chrome is required to exercise the Expo screen.');
  }
  return found;
}

function startStub() {
  const requests: string[] = [];
  const server = createServer((request, response) => {
    requests.push(`${request.method ?? 'GET'} ${request.url ?? '/'}`);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('{}');
  });
  return new Promise<{ requests: string[]; close: () => Promise<void> }>((resolve) => {
    server.listen(stubPort, '127.0.0.1', () => {
      resolve({
        requests,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
          }),
      });
    });
  });
}

function killPort(targetPort: number): Promise<void> {
  const listing = spawn('netstat', ['-ano'], { shell: true, stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  listing.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });
  return new Promise((resolve) => {
    listing.on('exit', () => {
      const pids = new Set<string>();
      for (const line of output.split(/\r?\n/)) {
        if (!line.includes(`:${targetPort}`) || !line.includes('LISTENING')) {
          continue;
        }
        const pid = line.trim().split(/\s+/).at(-1);
        if (pid && pid !== '0') {
          pids.add(pid);
        }
      }
      if (pids.size === 0) {
        resolve();
        return;
      }
      let remaining = pids.size;
      for (const pid of pids) {
        const killer = spawn('taskkill', ['/PID', pid, '/T', '/F'], { shell: true, stdio: 'ignore' });
        killer.on('exit', () => {
          remaining -= 1;
          if (remaining === 0) {
            resolve();
          }
        });
      }
    });
  });
}

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: root,
    env,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on('data', (chunk) => {
    output += chunk.toString();
  });
  return {
    child,
    output: () => output,
    stop: () => {
      if (child.pid) {
        spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
      }
    },
  };
}

async function waitForHttp(url: string, output: () => string): Promise<void> {
  const started = Date.now();
  let lastError = 'not started';
  while (Date.now() - started < 180000) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) {
        return;
      }
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (/error|unable to|exited/i.test(output()) && Date.now() - started > 20000) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Expo web did not start: ${lastError}\n${output().slice(-4000)}`);
}

type CdpMessage = { id?: number; method?: string; result?: unknown; error?: { message?: string } };

async function driveScreen(pageWs: string): Promise<string[]> {
  const ws = new WebSocket(pageWs);
  const pending = new Map<number, (message: CdpMessage) => void>();
  const network: string[] = [];
  let nextId = 0;
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', () => reject(new Error('browser debugger connection failed')));
  });
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as CdpMessage;
    if (message.method === 'Network.requestWillBeSent') {
      const url = (message as { params?: { request?: { url?: string } } }).params?.request?.url ?? '';
      network.push(url);
    }
    if (message.id != null && pending.has(message.id)) {
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  function send(method: string, params: Record<string, unknown> = {}): Promise<CdpMessage> {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      pending.set(id, resolve);
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`${method} timed out`));
        }
      }, 30000);
    });
  }
  await send('Network.enable');
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Page.navigate', { url: `http://127.0.0.1:${port}/local-validation` });
  const started = Date.now();
  let text = '';
  while (Date.now() - started < 90000) {
    const evaluated = await send('Runtime.evaluate', {
      expression: 'document.body ? document.body.innerText : ""',
      returnByValue: true,
    });
    text = String((evaluated.result as { result?: { value?: string } } | undefined)?.result?.value ?? '');
    if (
      text.includes('Import a workout') &&
      text.includes('Choose a .txt file') &&
      text.includes('Bench Press') &&
      text.includes(`3 ${times} 8`) &&
      text.includes('Shoulder Press') &&
      text.includes(`3 ${times} 10`) &&
      text.includes(`BW ${times} 8`)
    ) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (
    !text.includes('Import a workout') ||
    !text.includes('Choose a .txt file') ||
    !text.includes('Bench Press') ||
    !text.includes(`3 ${times} 8`) ||
    !text.includes('Shoulder Press') ||
    !text.includes(`3 ${times} 10`) ||
    !text.includes(`BW ${times} 8`)
  ) {
    throw new Error(`Expo screen did not render the import and history lines.\n${text.slice(0, 2000)}`);
  }
  const ready = await send('Runtime.evaluate', {
    expression: `(() => {
      let node = document.querySelector('[aria-label="Import & Save Routine"]');
      while (node) {
        if (Object.keys(node).some((key) => key.startsWith('__reactProps'))) return 'ready';
        node = node.parentElement;
      }
      return 'pending';
    })()`,
    returnByValue: true,
  });
  if ((ready.result as { result?: { value?: string } }).result?.value !== 'ready') {
    const hydrated = Date.now();
    let state = 'pending';
    while (Date.now() - hydrated < 30000) {
      const again = await send('Runtime.evaluate', {
        expression: `(() => {
          let node = document.querySelector('[aria-label="Import & Save Routine"]');
          while (node) {
            if (Object.keys(node).some((key) => key.startsWith('__reactProps'))) return 'ready';
            node = node.parentElement;
          }
          return 'pending';
        })()`,
        returnByValue: true,
      });
      state = String((again.result as { result?: { value?: string } }).result?.value ?? 'pending');
      if (state === 'ready') {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    if (state !== 'ready') {
      throw new Error('Expo screen rendered before the import button was interactive.');
    }
  }
  const clicked = await send('Runtime.evaluate', {
    expression: `(() => {
      let node = document.querySelector('[aria-label="Import & Save Routine"]');
      while (node) {
        const propsKey = Object.keys(node).find((key) => key.startsWith('__reactProps'));
        const props = propsKey ? node[propsKey] : null;
        if (props && typeof props.onClick === 'function') {
          props.onClick({ altKey: false, stopPropagation() {}, preventDefault() {}, nativeEvent: {}, currentTarget: node, target: node });
          return 'pressed';
        }
        node = node.parentElement;
      }
      return 'missing-handler';
    })()`,
    returnByValue: true,
  });
  const clickResult = (clicked.result as { result?: { value?: string } }).result?.value;
  if (clickResult !== 'pressed' && clickResult !== 'clicked') {
    throw new Error(`Import & Save Routine button was not found (${clickResult ?? 'no result'}).`);
  }
  text = await waitForText('Paste a workout before importing. Nothing was saved.');
  const typed = await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('[aria-label="Workout text"]');
      if (!(input instanceof HTMLTextAreaElement)) return 'missing-input';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, 'Bench press 3 x 8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      let node = document.querySelector('[aria-label="Import & Save Routine"]');
      while (node) {
        const propsKey = Object.keys(node).find((key) => key.startsWith('__reactProps'));
        const props = propsKey ? node[propsKey] : null;
        if (props && typeof props.onClick === 'function') {
          props.onClick({ altKey: false, stopPropagation() {}, preventDefault() {}, nativeEvent: {}, currentTarget: node, target: node });
          return input.value;
        }
        node = node.parentElement;
      }
      return 'missing-handler';
    })()`,
    returnByValue: true,
  });
  if ((typed.result as { result?: { value?: string } }).result?.value !== 'Bench press 3 x 8') {
    throw new Error('Workout text input did not accept the pasted week.');
  }
  text = await waitForText('Workout import stays off in this build. Nothing was saved.');
  const saveControl = await send('Runtime.evaluate', {
    expression: 'document.querySelector(\'[aria-label="Save imported routine"]\') ? "present" : "absent"',
    returnByValue: true,
  });
  if ((saveControl.result as { result?: { value?: string } }).result?.value !== 'absent') {
    throw new Error('Save imported routine appeared while import is off.');
  }
  for (const expected of [
    'Bench Press',
    'Shoulder Press',
    `3 ${times} 8`,
    `3 ${times} 10`,
    'Matched to a catalog exercise.',
    'Ambiguous. More than one catalog exercise fits.',
    'Rest 90 seconds.',
    'Weight 135.',
    'Imported weight stays on this screen and is not stored yet.',
    'Rest stays on this screen. This build does not store rest yet.',
    'Search the catalog to choose or change this match.',
    'Choose a catalog exercise for every unresolved movement before saving.',
  ]) {
    if (!text.includes(expected)) {
      throw new Error(`Import review line missing from the Expo screen: ${expected}`);
    }
  }
  await expectImportSave(false, '0', 'while a match was unresolved');
  const invalid = await send('Runtime.evaluate', {
    expression: `(() => {
      function fill(label, value) {
        const node = document.querySelector('[aria-label="' + label + '"]');
        if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return false;
        const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      if (!fill('Sets for exercise 1 on day 1', '0')) return 'missing-sets';
      if (!fill('Rest for exercise 1 on day 1', '999')) return 'missing-rest';
      return 'invalid';
    })()`,
    returnByValue: true,
  });
  if ((invalid.result as { result?: { value?: string } }).result?.value !== 'invalid') {
    throw new Error('The review inputs did not accept an invalid value.');
  }
  text = await waitForText('Enter sets from 1 through 12.');
  text = await waitForText('Enter rest from 0 through 600 seconds.');
  if (!text.includes(`3 ${times} 8`) || !text.includes('Rest 90 seconds.')) {
    throw new Error('An invalid edit replaced the imported sets or rest.');
  }
  const corrected = await send('Runtime.evaluate', {
    expression: `(() => {
      function fill(label, value) {
        const node = document.querySelector('[aria-label="' + label + '"]');
        if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return false;
        const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value')?.set?.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
      function press(label) {
        let node = document.querySelector('[aria-label="' + label + '"]');
        while (node) {
          const propsKey = Object.keys(node).find((key) => key.startsWith('__reactProps'));
          const props = propsKey ? node[propsKey] : null;
          if (props && typeof props.onClick === 'function') {
            props.onClick({ altKey: false, stopPropagation() {}, preventDefault() {}, nativeEvent: {}, currentTarget: node, target: node });
            return true;
          }
          node = node.parentElement;
        }
        return false;
      }
      if (!fill('Sets for exercise 1 on day 1', '4')) return 'missing-sets';
      if (!fill('Rest for exercise 1 on day 1', '45')) return 'missing-rest';
      if (!fill('Imported name for exercise 1 on day 1', 'Flat Bench')) return 'missing-name';
      if (!fill('Day 1 subtitle', 'Upper')) return 'missing-subtitle';
      if (!press('Choose Dumbbell Shoulder Press for exercise 1 on day 1')) return 'missing-single-match';
      if (!press('Choose Barbell Shoulder Press for exercise 2 on day 1')) return 'missing-ambiguous';
      return 'corrected';
    })()`,
    returnByValue: true,
  });
  if ((corrected.result as { result?: { value?: string } }).result?.value !== 'corrected') {
    throw new Error(`The review did not accept the edits (${(corrected.result as { result?: { value?: string } }).result?.value ?? 'no result'}).`);
  }
  text = await waitForText('Corrected to a chosen exercise.');
  text = await waitForText(`4 ${times} 8`);
  text = await waitForText('Rest 45 seconds.');
  const entered = await send('Runtime.evaluate', {
    expression: `(() => {
      function valueOf(label) {
        const node = document.querySelector('[aria-label="' + label + '"]');
        if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return 'missing';
        return node.value;
      }
      return [
        valueOf('Imported name for exercise 1 on day 1'),
        valueOf('Day 1 subtitle'),
        valueOf('Sets for exercise 1 on day 1'),
        valueOf('Rest for exercise 1 on day 1'),
        valueOf('Imported name for exercise 2 on day 1'),
        valueOf('Notes for exercise 1 on day 1'),
      ].join('|');
    })()`,
    returnByValue: true,
  });
  const enteredValue = String((entered.result as { result?: { value?: string } }).result?.value ?? '');
  if (enteredValue !== 'Flat Bench|Upper|4|45|Shoulder Press|') {
    throw new Error(`Edited fields were not kept: ${enteredValue}`);
  }
  if (!text.includes(`3 ${times} 10`) || !text.includes('Weight 135.')) {
    throw new Error('Editing one exercise changed the other exercise on the review.');
  }
  if (text.includes('Choose a catalog exercise for every unresolved movement before saving.')) {
    throw new Error('Unresolved exercises still blocked the draft after a catalog choice.');
  }
  const saveAfterEdit = await send('Runtime.evaluate', {
    expression: 'document.querySelector(\'[aria-label="Save imported routine"]\') ? "present" : "absent"',
    returnByValue: true,
  });
  if ((saveAfterEdit.result as { result?: { value?: string } }).result?.value !== 'absent') {
    throw new Error('Editing the review saved it or revealed the save control on the disabled screen.');
  }
  await expectImportSave(true, '0', 'after the draft was corrected');
  const partialWeight = await fillLabeled(
    'Planned weight for exercise 1 on day 1',
    '135.',
    'Import review fixture',
  );
  if (partialWeight !== '135.') {
    throw new Error(`Planned weight field did not keep the partial value: ${partialWeight}`);
  }
  text = await waitForText('Enter a planned weight from 0 through 2000, or leave it blank.');
  if (!text.includes('Weight 135.')) {
    throw new Error('A partial planned weight replaced the imported weight.');
  }
  await expectImportSave(false, '0', 'while the planned weight was invalid');
  await pressLabeled('Save reviewed import draft');
  await expectImportSave(false, '0', 'after pressing the disabled import save button');
  const committedWeight = await fillLabeled(
    'Planned weight for exercise 1 on day 1',
    '60',
    'Import review fixture',
  );
  if (committedWeight !== '60') {
    throw new Error(`Planned weight field did not keep 60: ${committedWeight}`);
  }
  text = await waitForText('Weight 60. Unit not specified.');
  await pressLabeled('Planned weight unit lb for exercise 1 on day 1', 'Import review fixture');
  text = await waitForText('Weight 60 lb.');
  await expectImportSave(true, '0', 'after the planned weight was corrected');
  await pressLabeled('Save reviewed import draft', 'Import review fixture');
  await expectImportSave(true, '1', 'after the local import save press');
  const routineName = await fillLabeled('Program name', 'Home Routine', 'Routine builder fixture');
  if (routineName !== 'Home Routine') {
    throw new Error(`Routine name field did not keep the edit: ${routineName}`);
  }
  const routineDay = await fillLabeled('Day 1 name', 'Push', 'Routine builder fixture');
  if (routineDay !== 'Push') {
    throw new Error(`Routine day name was not kept: ${routineDay}`);
  }
  await pressLabeled('Add exercise to day 1', 'Routine builder fixture');
  let routineSets = 'missing';
  const setsDeadline = Date.now() + 5000;
  while (Date.now() < setsDeadline && routineSets === 'missing') {
    routineSets = await fillLabeled('Sets for exercise 1 on day 1', '4', 'Routine builder fixture');
    if (routineSets === 'missing') {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  if (routineSets !== '4') {
    throw new Error(`Routine sets field did not keep 4: ${routineSets}`);
  }
  await expectRoutineSave(false, 'Save and use this routine', '0', 'before the first save');
  await pressLabeled('Save and use this routine', 'Routine builder fixture');
  text = await waitForText('Saving...');
  await expectRoutineSave(true, 'Saving...', '1', 'while the first save is in progress');
  await pressLabeled('Save and use this routine', 'Routine builder fixture');
  await expectRoutineSave(true, 'Saving...', '1', 'after a second press while saving');
  for (const expected of [
    `BW ${times} 8`,
    `BW + 25 lb ${times} 5`,
    `Assisted 20 lb ${times} 6`,
    `135 lb ${times} 5`,
  ]) {
    if (!text.includes(expected)) {
      throw new Error(`History line missing from the Expo screen: ${expected}`);
    }
  }
  const blocked = network.filter((url) =>
    /api\.x\.ai|supabase\.co|functions\/v1\/import-workout/i.test(url),
  );
  if (blocked.length > 0) {
    throw new Error(`Expo screen called a remote import or production host: ${blocked.join(', ')}`);
  }
  ws.close();
  return network;

  async function evaluated(expression: string): Promise<string> {
    const message = await send('Runtime.evaluate', { expression, returnByValue: true });
    const payload = message.result as
      | {
          result?: { value?: string };
          exceptionDetails?: { text?: string; exception?: { description?: string } };
        }
      | undefined;
    if (payload?.exceptionDetails) {
      const detail =
        payload.exceptionDetails.exception?.description ??
        payload.exceptionDetails.text ??
        'page expression failed';
      throw new Error(detail);
    }
    return String(payload?.result?.value ?? '');
  }

  async function expectImportSave(enabled: boolean, presses: string, why: string) {
    const actual = await importSaveState();
    const [state, disabled, count] = actual.split('|');
    const disabledOk = enabled ? disabled !== 'true' : disabled === 'true';
    if (state !== (enabled ? 'enabled' : 'disabled') || count !== presses || !disabledOk) {
      throw new Error(`Import save state was wrong ${why}: ${actual}`);
    }
  }

  async function expectRoutineSave(disabled: boolean, label: string, presses: string, why: string) {
    const actual = await buttonState('Save and use this routine', 'Routine builder fixture');
    const [aria, textValue, count] = actual.split('|');
    const disabledOk = disabled ? aria === 'true' : aria !== 'true';
    if (!disabledOk || !textValue.includes(label) || count !== presses) {
      throw new Error(`Routine save button was wrong ${why}: ${actual}`);
    }
  }

  async function importSaveState(): Promise<string> {
    return evaluated(`(() => {
      const state = document.querySelector('[aria-label="Import draft save state"]');
      const button = document.querySelector('[aria-label="Save reviewed import draft"]');
      const presses = document.querySelector('[aria-label="Import draft save presses"]');
      return [(state && state.textContent) || '', (button && button.getAttribute('aria-disabled')) || '', (presses && presses.textContent) || ''].join('|');
    })()`);
  }

  function scopedQuery(label: string, rootLabel?: string): string {
    const root = rootLabel
      ? `document.querySelector('[aria-label="${rootLabel}"]')`
      : 'document';
    return `(() => {
      const root = ${root};
      if (!root) return null;
      return root.querySelector('[aria-label="${label}"]');
    })()`;
  }

  async function readLabeled(label: string, rootLabel?: string): Promise<string> {
    return evaluated(`(() => {
      const node = ${scopedQuery(label, rootLabel)};
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return 'missing';
      return node.value;
    })()`);
  }

  async function fillLabeled(label: string, value: string, rootLabel?: string): Promise<string> {
    const literal = JSON.stringify(value);
    const wrote = await evaluated(`(() => {
      const node = ${scopedQuery(label, rootLabel)};
      if (!(node instanceof HTMLInputElement || node instanceof HTMLTextAreaElement)) return 'missing';
      const proto = node instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (typeof setter !== 'function') return 'missing-setter';
      setter.call(node, ${literal});
      const tracker = node._valueTracker;
      if (tracker && typeof tracker.setValue === 'function') tracker.setValue('');
      node.dispatchEvent(new Event('input', { bubbles: true }));
      return 'wrote';
    })()`);
    if (wrote !== 'wrote') {
      return wrote;
    }
    const deadline = Date.now() + 2000;
    let latest = '';
    while (Date.now() < deadline) {
      latest = await readLabeled(label, rootLabel);
      if (latest === value) {
        return latest;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return latest;
  }

  async function pressLabeled(label: string, rootLabel?: string): Promise<string> {
    return evaluated(`(() => {
      let node = ${scopedQuery(label, rootLabel)};
      while (node) {
        const propsKey = Object.keys(node).find((key) => key.startsWith('__reactProps'));
        const props = propsKey ? node[propsKey] : null;
        if (props && typeof props.onClick === 'function') {
          props.onClick({ altKey: false, stopPropagation() {}, preventDefault() {}, nativeEvent: {}, currentTarget: node, target: node });
          return 'pressed';
        }
        node = node.parentElement;
      }
      return 'missing-handler';
    })()`);
  }

  async function buttonState(label: string, rootLabel?: string): Promise<string> {
    return evaluated(`(() => {
      const button = ${scopedQuery(label, rootLabel)};
      const presses = document.querySelector('[aria-label="Routine save presses"]');
      return [(button && button.getAttribute('aria-disabled')) || '', (button && button.innerText) || '', (presses && presses.textContent) || ''].join('|');
    })()`);
  }

  async function waitForText(needle: string): Promise<string> {
    const deadline = Date.now() + 20000;
    let latest = '';
    while (Date.now() < deadline) {
      const evaluated = await send('Runtime.evaluate', {
        expression: 'document.body ? document.body.innerText : ""',
        returnByValue: true,
      });
      latest = String((evaluated.result as { result?: { value?: string } } | undefined)?.result?.value ?? '');
      if (latest.includes(needle)) {
        return latest;
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    throw new Error(`Timed out waiting for: ${needle}\n${latest.slice(0, 2000)}`);
  }
}

async function browserPage(): Promise<{ ws: string; stop: () => void }> {
  const profile = await mkdtemp(join(tmpdir(), 'syncsetrep-expo-browser-'));
  const browser = spawnProcess(
    `"${browserPath()}"`,
    [
      '--headless=new',
      '--disable-gpu',
      `--remote-debugging-port=${debugPort}`,
      `--user-data-dir=${profile}`,
      'about:blank',
    ],
    process.env,
  );
  const started = Date.now();
  let pageWs = '';
  while (Date.now() - started < 30000) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const pages = (await response.json()) as Array<{ type?: string; webSocketDebuggerUrl?: string }>;
      pageWs = pages.find((page) => page.type === 'page' && page.webSocketDebuggerUrl)?.webSocketDebuggerUrl ?? '';
      if (pageWs) {
        break;
      }
    } catch {
      pageWs = '';
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  if (!pageWs) {
    browser.stop();
    throw new Error(`Browser debugger did not start.\n${browser.output().slice(-2000)}`);
  }
  return {
    ws: pageWs,
    stop: () => {
      browser.stop();
      setTimeout(() => {
        void rm(profile, { recursive: true, force: true }).catch(() => undefined);
      }, 1500);
    },
  };
}

const marker = '        <Stack.Screen name="local-validation" options={{ headerShown: false }} />\n';
const layoutNeedle = '      <Stack screenOptions={{ headerShown: false }}>\n';
const originalLayout = (await readFile(layoutPath, 'utf8')).replace(marker, '');
if (!originalLayout.includes(layoutNeedle) || originalLayout.includes('local-validation')) {
  throw new Error('Could not attach the temporary Expo validation route.');
}
const stub = await startStub();
let expo: ReturnType<typeof spawnProcess> | null = null;
let browser: { stop: () => void } | null = null;
try {
  await writeFile(routePath, routeSource, 'utf8');
  await writeFile(layoutPath, originalLayout.replace(layoutNeedle, `${layoutNeedle}${marker}`), 'utf8');
  expo = spawnProcess(
    'npx',
    ['expo', 'start', '--web', '--port', String(port), '--host', 'localhost'],
    {
      ...process.env,
      CI: '1',
      EXPO_NO_TELEMETRY: '1',
      EXPO_PUBLIC_SUPABASE_URL: `http://127.0.0.1:${stubPort}`,
      EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'local-validation-only',
    },
  );
  await waitForHttp(`http://127.0.0.1:${port}`, expo.output);
  browser = await browserPage();
  const network = await driveScreen(browser.ws);
  const productionCalls = network.filter((url) => /supabase\.co|api\.x\.ai/i.test(url));
  if (productionCalls.length > 0 || stub.requests.some((line) => /supabase\.co/i.test(line))) {
    throw new Error('Validation reached a production host.');
  }
  console.log('expo import screen checks passed');
  console.log(`expo history lines rendered: bodyweight, added, assisted, legacy`);
  console.log(`expo local stub requests: ${stub.requests.length}`);
} finally {
  browser?.stop();
  expo?.stop();
  await killPort(port);
  await killPort(debugPort);
  await writeFile(layoutPath, originalLayout, 'utf8');
  await rm(routePath, { force: true });
  await stub.close();
}
