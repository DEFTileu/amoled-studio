/** Desktop Studio runtime contract v1; backend implementation is the source of truth. */
export type RuntimeKind = 'simulator' | 'firmware';
export type RuntimeState = 'stopped' | 'running' | 'failed';
export interface FirmwareImages { bootloader: string; partition_table: string; app: string; elf: string | null }
export type RuntimeConfig =
  | { mode: 'simulator'; battery_percent: number; brightness_percent: number; accel_x: number; time_ms: number }
  | { mode: 'firmware'; flash_mb: 16 | 32; psram_mb: 8; images: FirmwareImages };
export interface RuntimeStatus { api_version: 1; board: string; state: RuntimeState; kind: RuntimeKind | null; pid: number | null; viewer_url: string | null; exit_code: number | null; error: string | null }
export interface BoardProfile { api_version: 1; id: string; width: 466; height: 466; shape: 'round'; flash_options_mb: number[]; psram_mb: 8 }
export interface LogEntry { stream: 'stdout' | 'stderr'; message: string }
export interface FrameSnapshot { width: number; height: number; format: 'png_base64'; data_base64: string }
export interface TouchRequest { action: 'press' | 'move' | 'release'; x: number; y: number }
