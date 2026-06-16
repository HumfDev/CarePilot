/**
 * Thin wrapper around the CarePilot Referral Copilot Python CLI bridge.
 *
 * The bridge contract is documented in docs/referral_ui_integration_plan.md.
 * Every call spawns `referral_cli.py --op <op>`, writes the request JSON to
 * stdin, and waits for a single JSON response on stdout. The Python side
 * captures pipeline `print()` noise into stderr so stdout only ever contains
 * the structured response.
 *
 * The DataFrame load is the slow part (~5–10 s); the CLI caches a pickle of
 * the cleaned data so subsequent calls return in ~1 s. We do an opportunistic
 * `warmup` on server boot to absorb that cost up-front.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');
const CLI_PATH = path.join(REPO_ROOT, 'python_bridge', 'referral_cli.py');

const PYTHON_BIN = process.env.CAREPILOT_PYTHON ?? 'python3';
const DEFAULT_TIMEOUT_MS = Number(process.env.CAREPILOT_BRIDGE_TIMEOUT_MS ?? '25000');

export type ReferralOp =
  | 'parse'
  | 'search'
  | 'shortlist'
  | 'note'
  | 'review'
  | 'override'
  | 'workspace'
  | 'warmup'
  | 'summarize'
  | 'summarize_search'
  | 'chat'
  | 'classify_intent';

export interface BridgeOk<T> {
  ok: true;
  [key: string]: unknown;
  data: T;
}

export interface BridgeErr {
  ok: false;
  kind?: string;
  error?: string;
  needs_clarification?: 'location' | 'care_need' | 'both';
  message?: string;
  [key: string]: unknown;
}

export type BridgeResult<T = Record<string, unknown>> = (Omit<BridgeOk<T>, 'data'> & { data?: T }) | BridgeErr;

interface CallOptions {
  /** Override per-call timeout (defaults to CAREPILOT_BRIDGE_TIMEOUT_MS or 25s). */
  timeoutMs?: number;
}

function envForBridge(): NodeJS.ProcessEnv {
  // Pass through everything the CLI honours; allow overrides via process.env.
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (!env.CAREPILOT_BACKEND_DIR) {
    env.CAREPILOT_BACKEND_DIR = '/Users/joon/carepilot-referral';
  }
  if (!env.CAREPILOT_BACKEND_CSV) {
    env.CAREPILOT_BACKEND_CSV = path.join(env.CAREPILOT_BACKEND_DIR, 'clean_facilities_v4.csv');
  }
  return env;
}

/**
 * Spawn the Python CLI for a single op and return its JSON response.
 *
 * Rejects on:
 *   - process exit with a non-JSON stdout
 *   - subprocess timeout
 *   - process error (e.g. python3 not on PATH)
 */
export function callPythonBridge<T = Record<string, unknown>>(
  op: ReferralOp,
  payload: unknown,
  options: CallOptions = {}
): Promise<BridgeResult<T>> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [CLI_PATH, '--op', op], {
      cwd: REPO_ROOT,
      env: envForBridge(),
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`python_bridge ${op}: timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk));

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`python_bridge ${op}: spawn failed (${err.message})`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const stdout = Buffer.concat(stdoutChunks).toString('utf-8').trim();
      const stderr = Buffer.concat(stderrChunks).toString('utf-8').trim();

      if (!stdout) {
        const tail = stderr.split('\n').slice(-5).join('\n');
        reject(new Error(`python_bridge ${op}: empty stdout (exit=${code}) — stderr tail:\n${tail}`));
        return;
      }

      // The CLI emits exactly one JSON object on stdout (possibly with a
      // trailing newline). Split on the LAST newline to be defensive in case
      // any straggler prints leaked through.
      const lastBrace = stdout.lastIndexOf('\n');
      const jsonText = lastBrace === -1 ? stdout : stdout.slice(lastBrace + 1);
      try {
        const parsed = JSON.parse(jsonText) as BridgeResult<T>;
        if (!parsed.ok && stderr) {
          // Surface stderr context on errors to help debugging without spamming success cases.
          (parsed as BridgeErr).stderr_tail = stderr.split('\n').slice(-10).join('\n');
        }
        resolve(parsed);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reject(
          new Error(
            `python_bridge ${op}: failed to parse JSON (${message}). ` + `Raw stdout tail: ${jsonText.slice(0, 400)}`
          )
        );
      }
    });

    try {
      child.stdin.end(JSON.stringify(payload ?? {}));
    } catch (err) {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      const message = err instanceof Error ? err.message : String(err);
      reject(new Error(`python_bridge ${op}: failed to write stdin (${message})`));
    }
  });
}

/**
 * Best-effort warmup. Resolves with the row count on success; resolves with
 * `null` on failure (and logs to stderr) so server boot never blocks on the
 * Python bridge being healthy.
 */
export async function warmupPythonBridge(): Promise<number | null> {
  try {
    const result = await callPythonBridge<{ rows: number; cols: number }>('warmup', {}, { timeoutMs: 60_000 });
    if (result.ok) {
      const rows = (result as { rows?: number }).rows ?? null;
      console.log(`[python_bridge] warmup ok — ${rows ?? '?'} rows ready`);
      return rows;
    }
    console.warn('[python_bridge] warmup returned not-ok:', result);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[python_bridge] warmup failed (${message}) — calls will warm on first use`);
    return null;
  }
}
