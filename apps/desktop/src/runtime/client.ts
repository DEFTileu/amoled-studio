import type { BoardProfile, FirmwareImages, FrameSnapshot, LogEntry, RuntimeConfig, RuntimeStatus, TouchRequest } from '@contracts/v1';

/**
 * Everything the UI needs from a host. Components depend only on this interface; transports (Tauri IPC, browser HTTP)
 * live in separate adapter files. Method names and payloads mirror runtime/contracts/v1.ts one to one.
 */
export interface RuntimeClient {
  readonly transport: 'tauri' | 'browser';
  boardProfile(): Promise<BoardProfile>;
  defaultImages(): Promise<FirmwareImages>;
  start(config: RuntimeConfig): Promise<RuntimeStatus>;
  stop(): Promise<RuntimeStatus>;
  status(): Promise<RuntimeStatus>;
  logs(): Promise<LogEntry[]>;
  capture(): Promise<FrameSnapshot>;
  touch(request: TouchRequest): Promise<void>;
  /**
   * Live firmware frames, delivered as binary frames in the documented format (byte 1, u16le w, u16le h, RGB565 LE).
   * Each transport gets them its own way; returns an unsubscribe. Reconnection is the adapter's job.
   */
  frames(status: RuntimeStatus, onFrame: (frame: ArrayBuffer) => void): () => void;
  /** Host capabilities; the UI disables what a host cannot do. */
  readonly canPickFile: boolean;
  /** Native picker returning an absolute path, or null if cancelled. */
  pickFile(): Promise<string | null>;
  /** Save bytes (e.g. a screenshot). Returns where it went, or null if cancelled. */
  saveFile(suggestedName: string, bytes: Uint8Array): Promise<string | null>;
}

/** Backend errors arrive as plain strings. */
export const errMsg = (e: unknown): string => (typeof e === 'string' ? e : e instanceof Error ? e.message : JSON.stringify(e));

/** Saves the emulator's current 466 × 466 framebuffer (capture_framebuffer) as PNG. */
export async function saveScreenshot(c: RuntimeClient): Promise<string | null> {
  const snap = await c.capture();
  return c.saveFile(`amoled-${Date.now()}.png`, Uint8Array.from(atob(snap.data_base64), (ch) => ch.charCodeAt(0)));
}
