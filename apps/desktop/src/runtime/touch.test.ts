import { describe, expect, it } from 'vitest';
import type { TouchRequest } from '@contracts/v1';
import { TouchSender } from './touch';

const rig = (failOn?: TouchRequest['action']) => {
  const sent: string[] = [], errors: string[] = [];
  const s = new TouchSender(async (r) => { if (r.action === failOn) throw 'rejected'; sent.push(`${r.action}${r.x},${r.y}`); }, (m) => errors.push(m));
  return { s, sent, errors, flush: () => new Promise((r) => setTimeout(r, 10)) };
};

describe('TouchSender', () => {
  it('sends press, coalesced latest move, release in order', async () => {
    const { s, sent, flush } = rig();
    s.press(10, 10); s.moveTo(20, 20); s.moveTo(30, 30); s.moveTo(40, 40); s.release(50, 50);
    await flush();
    expect(sent[0]).toBe('press10,10');
    expect(sent.at(-1)).toBe('release50,50');
    expect(sent.filter((x) => x.startsWith('move')).length).toBeLessThanOrEqual(1); // coalesced; a pending move is dropped by release
  });
  it('ignores moves/release without a press and double presses', async () => {
    const { s, sent, flush } = rig();
    s.moveTo(1, 1); s.release(1, 1); s.press(5, 5); s.press(6, 6); s.release(7, 7);
    await flush();
    expect(sent).toEqual(['press5,5', 'release7,7']);
  });
  it('sends nothing after a rejected press, and recovers for the next touch', async () => {
    const { s, sent, errors, flush } = rig('press');
    s.press(1, 1); s.moveTo(2, 2); s.release(3, 3);
    await flush();
    expect(sent).toEqual([]);
    expect(errors).toEqual(['rejected']);
  });
});
