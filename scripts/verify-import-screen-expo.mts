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

const routeSource = `import { Text, View } from 'react-native';

import ImportWorkoutScreen from './(tabs)/program/import';
import { historySetDisplayLine, historySetTracking } from '@/lib/history-sets';

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
    if (text.includes('Import a workout') && text.includes(`BW ${times} 8`)) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!text.includes('Import a workout') || !text.includes(`BW ${times} 8`)) {
    throw new Error(`Expo screen did not render the import and history lines.\n${text.slice(0, 2000)}`);
  }
  const ready = await send('Runtime.evaluate', {
    expression: `(() => {
      let node = document.querySelector('[aria-label="Read workout text"]');
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
          let node = document.querySelector('[aria-label="Read workout text"]');
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
      let node = document.querySelector('[aria-label="Read workout text"]');
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
    throw new Error(`Read workout text button was not found (${clickResult ?? 'no result'}).`);
  }
  text = await waitForText('Paste a workout before importing. Nothing was saved.');
  const typed = await send('Runtime.evaluate', {
    expression: `(() => {
      const input = document.querySelector('[aria-label="Workout text"]');
      if (!(input instanceof HTMLTextAreaElement)) return 'missing-input';
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
      setter?.call(input, 'Bench press 3 x 8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      let node = document.querySelector('[aria-label="Read workout text"]');
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
  if (text.includes('Save imported routine')) {
    throw new Error('Save imported routine appeared while import is off.');
  }
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
