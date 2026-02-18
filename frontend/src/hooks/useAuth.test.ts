import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAuth } from './useAuth';

vi.mock('../lib/api', () => ({ apiJson: vi.fn() }));
import { apiJson } from '../lib/api';

const STORAGE_KEY = 'redarm_auth';

const mockLoginResponse = {
  accessToken: 'test-token-abc123',
  expiresIn: '3600',
  user: {
    email: 'admin@example.com',
    role: 'admin',
  },
};

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
});

describe('useAuth', () => {
  it('initial state is unauthenticated when sessionStorage is empty', () => {
    const { result } = renderHook(() => useAuth());

    expect(result.current.auth.isAuthenticated).toBe(false);
    expect(result.current.auth.token).toBe('');
    expect(result.current.auth.email).toBe('');
    expect(result.current.auth.role).toBe('');
    expect(result.current.isLoggingIn).toBe(false);
  });

  it('login calls apiJson with correct path, method, empty token, and credentials', async () => {
    vi.mocked(apiJson).mockResolvedValueOnce(mockLoginResponse);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login('admin@example.com', 'secret123');
    });

    expect(apiJson).toHaveBeenCalledOnce();
    expect(apiJson).toHaveBeenCalledWith(
      '/auth/login',
      'POST',
      '',
      { email: 'admin@example.com', password: 'secret123' }
    );
  });

  it('login updates auth state on success', async () => {
    vi.mocked(apiJson).mockResolvedValueOnce(mockLoginResponse);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login('admin@example.com', 'secret123');
    });

    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.auth.token).toBe('test-token-abc123');
    expect(result.current.auth.email).toBe('admin@example.com');
    expect(result.current.auth.role).toBe('admin');
  });

  it('login returns the new AuthState on success', async () => {
    vi.mocked(apiJson).mockResolvedValueOnce(mockLoginResponse);

    const { result } = renderHook(() => useAuth());

    let returnedState: Awaited<ReturnType<typeof result.current.login>>;
    await act(async () => {
      returnedState = await result.current.login('admin@example.com', 'secret123');
    });

    expect(returnedState!).toEqual({
      token: 'test-token-abc123',
      email: 'admin@example.com',
      role: 'admin',
      isAuthenticated: true,
    });
  });

  it('login sets isLoggingIn to true during request and resets to false after', async () => {
    let resolveLogin!: (value: typeof mockLoginResponse) => void;
    const pending = new Promise<typeof mockLoginResponse>((res) => { resolveLogin = res; });
    vi.mocked(apiJson).mockReturnValueOnce(pending as any);

    const { result } = renderHook(() => useAuth());

    // Start login without awaiting
    act(() => { void result.current.login('admin@example.com', 'secret123'); });

    // isLoggingIn should be true while the promise is unresolved
    expect(result.current.isLoggingIn).toBe(true);

    // Now resolve and wait for state to settle
    await act(async () => { resolveLogin(mockLoginResponse); });

    expect(result.current.isLoggingIn).toBe(false);
  });

  it('login rethrows on API error', async () => {
    const apiError = new Error('Invalid credentials');
    vi.mocked(apiJson).mockRejectedValueOnce(apiError);

    const { result } = renderHook(() => useAuth());

    await expect(
      act(async () => {
        await result.current.login('wrong@example.com', 'badpassword');
      })
    ).rejects.toThrow('Invalid credentials');
  });

  it('isLoggingIn resets to false after API error', async () => {
    vi.mocked(apiJson).mockRejectedValueOnce(new Error('Network error'));

    const { result } = renderHook(() => useAuth());

    try {
      await act(async () => {
        await result.current.login('admin@example.com', 'secret123');
      });
    } catch {
      // expected to throw
    }

    expect(result.current.isLoggingIn).toBe(false);
  });

  it('logout clears auth state back to unauthenticated defaults', async () => {
    vi.mocked(apiJson).mockResolvedValueOnce(mockLoginResponse);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login('admin@example.com', 'secret123');
    });

    expect(result.current.auth.isAuthenticated).toBe(true);

    act(() => {
      result.current.logout();
    });

    expect(result.current.auth.isAuthenticated).toBe(false);
    expect(result.current.auth.token).toBe('');
    expect(result.current.auth.email).toBe('');
    expect(result.current.auth.role).toBe('');
  });

  it('saves auth to sessionStorage after successful login', async () => {
    vi.mocked(apiJson).mockResolvedValueOnce(mockLoginResponse);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login('admin@example.com', 'secret123');
    });

    const stored = sessionStorage.getItem(STORAGE_KEY);
    expect(stored).not.toBeNull();

    const parsed = JSON.parse(stored!);
    expect(parsed.token).toBe('test-token-abc123');
    expect(parsed.email).toBe('admin@example.com');
    expect(parsed.role).toBe('admin');
    expect(parsed.isAuthenticated).toBe(true);
  });

  it('removes auth from sessionStorage after logout', async () => {
    vi.mocked(apiJson).mockResolvedValueOnce(mockLoginResponse);

    const { result } = renderHook(() => useAuth());

    await act(async () => {
      await result.current.login('admin@example.com', 'secret123');
    });

    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();

    act(() => {
      result.current.logout();
    });

    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('loads persisted session from sessionStorage on init', () => {
    const persisted = {
      token: 'persisted-token-xyz',
      email: 'persisted@example.com',
      role: 'editor',
      isAuthenticated: true,
    };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persisted));

    const { result } = renderHook(() => useAuth());

    expect(result.current.auth.isAuthenticated).toBe(true);
    expect(result.current.auth.token).toBe('persisted-token-xyz');
    expect(result.current.auth.email).toBe('persisted@example.com');
    expect(result.current.auth.role).toBe('editor');
  });

  it('ignores malformed sessionStorage data and starts unauthenticated', () => {
    sessionStorage.setItem(STORAGE_KEY, 'not-valid-json{{');

    const { result } = renderHook(() => useAuth());

    expect(result.current.auth.isAuthenticated).toBe(false);
    expect(result.current.auth.token).toBe('');
  });

  it('ignores sessionStorage entry that has no token and starts unauthenticated', () => {
    // Stored data exists but has an empty token — should not restore session
    const incomplete = { token: '', email: 'ghost@example.com', role: 'viewer', isAuthenticated: true };
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(incomplete));

    const { result } = renderHook(() => useAuth());

    expect(result.current.auth.isAuthenticated).toBe(false);
    expect(result.current.auth.token).toBe('');
  });
});
