/**
 * Parsing the engine's stdout.
 *
 * `slv-engine.exe --cli` prints a human-readable Chinese log plus two machine
 * markers:
 *
 *   __SLV_EVENT__ {"event_type":"progress","overall":0.42,...}
 *   __STAGE__:图片 AI 超分：正在准备输入图片
 *
 * Progress arrives many times per second, so the parser stays allocation-light
 * and tolerant: unknown event types and malformed JSON are ignored instead of
 * failing a running job.
 */

export type UpscaleEngineEvent =
  | {
      kind: 'progress';
      progress: number;
      stage: string;
      message: string;
      speedFps: number | null;
      etaSeconds: number | null;
    }
  | { kind: 'stage'; stage: string }
  | { kind: 'selection'; gpu: string | null }
  | { kind: 'completed'; output: string | null; warnings: string[] }
  | { kind: 'failed'; message: string };

export type UpscaleEventParser = {
  push: (chunk: string) => UpscaleEngineEvent[];
  flush: () => UpscaleEngineEvent[];
  /** Most recent human-readable lines, oldest first; used for error messages. */
  tail: (maxLines?: number) => string[];
};

const EVENT_PREFIX = '__SLV_EVENT__';
const STAGE_PREFIX = '__STAGE__:';
const MAX_TAIL_LINES = 40;

const toNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const toText = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const parseEventPayload = (payload: string): UpscaleEngineEvent | null => {
  let parsed: Record<string, unknown>;
  try {
    const value = JSON.parse(payload) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    parsed = value as Record<string, unknown>;
  } catch {
    return null;
  }
  const eventType = toText(parsed.event_type);
  if (eventType === 'progress') {
    const overall = toNumber(parsed.overall);
    return {
      kind: 'progress',
      progress: overall === null ? 0 : Math.max(0, Math.min(1, overall)),
      stage: toText(parsed.stage),
      message: toText(parsed.message),
      speedFps: toNumber(parsed.speed_fps),
      etaSeconds: toNumber(parsed.eta_seconds),
    };
  }
  if (eventType === 'selection') {
    return { kind: 'selection', gpu: toText(parsed.ai_gpu) || null };
  }
  if (eventType === 'completed') {
    const warnings = Array.isArray(parsed.warnings)
      ? parsed.warnings.map((item) => toText(item)).filter(Boolean)
      : [];
    return { kind: 'completed', output: toText(parsed.output) || null, warnings };
  }
  if (eventType === 'failed' || eventType === 'error') {
    return {
      kind: 'failed',
      message: toText(parsed.message) || 'The upscale engine reported a failure.',
    };
  }
  return null;
};

export const createUpscaleEventParser = (): UpscaleEventParser => {
  let buffer = '';
  const recent: string[] = [];

  const remember = (line: string) => {
    const text = line.trim();
    if (!text || text.startsWith(EVENT_PREFIX) || text.startsWith(STAGE_PREFIX)) {
      return;
    }
    recent.push(text);
    if (recent.length > MAX_TAIL_LINES) recent.splice(0, recent.length - MAX_TAIL_LINES);
  };

  const handleLine = (rawLine: string, events: UpscaleEngineEvent[]) => {
    const line = rawLine.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trim();
    if (!line) return;
    if (line.startsWith(EVENT_PREFIX)) {
      const event = parseEventPayload(line.slice(EVENT_PREFIX.length).trim());
      if (event) events.push(event);
      return;
    }
    if (line.startsWith(STAGE_PREFIX)) {
      const stage = line.slice(STAGE_PREFIX.length).trim();
      if (stage) events.push({ kind: 'stage', stage });
      return;
    }
    remember(line);
  };

  const push = (chunk: string) => {
    const events: UpscaleEngineEvent[] = [];
    buffer += chunk;
    // Progress bars redraw with a bare carriage return.
    const parts = buffer.split(/\r\n|\n|\r/);
    buffer = parts.pop() ?? '';
    for (const part of parts) handleLine(part, events);
    return events;
  };

  const flush = () => {
    const events: UpscaleEngineEvent[] = [];
    if (buffer) {
      handleLine(buffer, events);
      buffer = '';
    }
    return events;
  };

  return {
    push,
    flush,
    tail: (maxLines = 8) => recent.slice(-maxLines),
  };
};

/**
 * Turn a non-zero exit into something a user can act on. The engine surfaces
 * Chinese diagnostics, so the common ones are mapped to a stable English
 * message and the raw tail is appended for anything unexpected.
 */
export const describeUpscaleFailure = ({
  exitCode,
  lines,
  cancelled,
}: {
  exitCode: number | null;
  lines: readonly string[];
  cancelled?: boolean;
}): string => {
  if (cancelled) return 'Upscale cancelled.';
  const joined = lines.join('\n');
  if (/Could not create temporary directory/i.test(joined)) {
    return 'The upscale engine could not unpack itself: its temporary directory is unusable.';
  }
  if (/no vulkan|vulkan.*not.*(found|supported)|找不到.*vulkan/i.test(joined)) {
    return 'No Vulkan-capable GPU was found, so the local upscale engine cannot run.';
  }
  if (/out of memory|内存不足|outofmemory/i.test(joined)) {
    return 'The upscale engine ran out of memory. Try a smaller scale.';
  }
  const lastLine = [...lines].reverse().find((line) => line.trim().length > 0);
  const suffix = lastLine ? `: ${lastLine.slice(0, 300)}` : '';
  return `The upscale engine exited with code ${exitCode ?? 'unknown'}${suffix}`;
};
