import { describe, it, expect } from 'vitest';

describe('Test infrastructure smoke test', () => {
  it('vitest globals work', () => {
    expect(1 + 1).toBe(2);
  });

  it('jsdom environment available', () => {
    expect(typeof document).toBe('object');
    expect(typeof window).toBe('object');
  });

  it('crypto.randomUUID available', () => {
    const id = crypto.randomUUID();
    expect(id).toBeTruthy();
  });
});
