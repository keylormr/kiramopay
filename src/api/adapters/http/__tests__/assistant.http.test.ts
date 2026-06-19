import { describe, it, expect, vi } from 'vitest';
import { HttpAssistantRepository } from '../assistant.http';
import type { HttpClient } from '../client';

function fakeClient(overrides: Partial<HttpClient>): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    ...overrides,
  } as unknown as HttpClient;
}

describe('HttpAssistantRepository', () => {
  it('reads availability', async () => {
    const repo = new HttpAssistantRepository(
      fakeClient({ get: vi.fn().mockResolvedValue({ success: true, data: { available: true } }) }),
    );
    const res = await repo.status();
    expect(res.data?.available).toBe(true);
  });

  it('treats a failed status call as unavailable', async () => {
    const repo = new HttpAssistantRepository(
      fakeClient({ get: vi.fn().mockResolvedValue({ success: false, error: { code: 'X', message: 'down' } }) }),
    );
    const res = await repo.status();
    expect(res.success).toBe(true);
    expect(res.data?.available).toBe(false);
  });

  it('sends message + history and maps tools_used → toolsUsed', async () => {
    const post = vi
      .fn()
      .mockResolvedValue({ success: true, data: { reply: 'You have ₡15,000.', tools_used: ['get_balance'] } });
    const repo = new HttpAssistantRepository(fakeClient({ post }));
    const res = await repo.chat('balance?', [{ role: 'user', text: 'hi' }]);
    expect(res.data?.reply).toBe('You have ₡15,000.');
    expect(res.data?.toolsUsed).toEqual(['get_balance']);
    expect(post).toHaveBeenCalledWith('/api/v1/assistant/chat', {
      message: 'balance?',
      history: [{ role: 'user', text: 'hi' }],
    });
  });

  it('surfaces a chat error', async () => {
    const repo = new HttpAssistantRepository(
      fakeClient({ post: vi.fn().mockResolvedValue({ success: false, error: { code: 'X', message: 'nope' } }) }),
    );
    const res = await repo.chat('hi');
    expect(res.success).toBe(false);
    expect(res.error?.message).toBe('nope');
  });
});
