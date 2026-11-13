/** Wire types for the authenticated loopback HTTP and WebSocket API. */
import type { BoardProfile, FrameSnapshot, LogEntry, RuntimeStatus, TouchRequest } from './v1';
export interface ApiError { api_version: 1; error: string }
export type StartRequest =
  | { mode: 'simulator'; battery_percent: number; brightness_percent: number; accel_x: number; time_ms: number }
  | { mode: 'firmware'; flash_mb: 16 | 32; psram_mb: 8; image_id: string };
export interface FirmwareUpload { bootloader_base64: string; partition_table_base64: string; app_base64: string; elf_base64?: string | null }
export interface UploadResponse { api_version: 1; image_id: string }
export interface BoardResponse { api_version: 1; board: BoardProfile }
export interface StatusResponse { api_version: 1; status: RuntimeStatus }
export interface ConfigResponse { api_version: 1; config: StartRequest | null }
export interface LogsResponse { api_version: 1; logs: LogEntry[] }
export interface FrameResponse { api_version: 1; frame: FrameSnapshot }
export type ClientMessage =
  | { type: 'auth'; token: string }
  | { type: 'subscribe'; status?: boolean; logs?: boolean; frames?: boolean; frame_rate?: number }
  | { type: 'touch'; request: TouchRequest };
export type ServerMessage =
  | { type: 'authenticated'; api_version: 1 }
  | { type: 'status'; status: RuntimeStatus }
  | { type: 'logs'; logs: LogEntry[] }
  | { type: 'frame'; frame: FrameSnapshot }
  | { type: 'touch_result'; ok: boolean; error?: string }
  | { type: 'error'; error: string };
