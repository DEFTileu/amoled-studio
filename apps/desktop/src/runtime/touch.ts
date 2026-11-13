import type { TouchRequest } from '@contracts/v1';

/**
 * Sends press → moves → release strictly in order. The backend rejects out-of-sequence input and each call opens a
 * websocket, so moves are coalesced to the latest one while a call is in flight. Release is always sent after an
 * accepted press, even if the pointer left the view.
 */
export class TouchSender {
  private chain: Promise<void> = Promise.resolve();
  private down = false;
  private pressed = false; // backend accepted the press
  private move: { x: number; y: number } | null = null;

  constructor(private send: (r: TouchRequest) => Promise<void>, private onError: (m: string) => void) {}

  private enqueue(job: () => Promise<void>) { this.chain = this.chain.then(job).catch((e) => this.onError(String(e))); }

  press(x: number, y: number) {
    if (this.down) return;
    this.down = true; this.pressed = false; this.move = null;
    this.enqueue(async () => { await this.send({ action: 'press', x, y }); this.pressed = true; });
  }
  moveTo(x: number, y: number) {
    if (!this.down) return;
    const idle = this.move === null;
    this.move = { x, y };
    if (idle) this.enqueue(async () => { const m = this.move; this.move = null; if (m && this.pressed) await this.send({ action: 'move', ...m }); });
  }
  release(x: number, y: number) {
    if (!this.down) return;
    this.down = false; this.move = null;
    this.enqueue(async () => { if (this.pressed) { this.pressed = false; await this.send({ action: 'release', x, y }); } });
  }
}
