import { describe, it, expect, beforeEach } from 'vitest';
import { useSyncStore } from '../sync.store';

describe('useSyncStore', () => {
  beforeEach(() => {
    useSyncStore.setState({
      isSyncing: false,
      lastSyncAt: null,
      syncError: null,
    });
  });

  it('should have initial state', () => {
    const state = useSyncStore.getState();
    expect(state.isSyncing).toBe(false);
    expect(state.lastSyncAt).toBeNull();
    expect(state.syncError).toBeNull();
  });

  it('should set syncing state', () => {
    useSyncStore.getState().setSyncing(true);
    const state = useSyncStore.getState();
    expect(state.isSyncing).toBe(true);
    expect(state.syncError).toBeNull();
  });

  it('should set sync complete', () => {
    useSyncStore.getState().setSyncing(true);
    useSyncStore.getState().setSyncComplete();
    const state = useSyncStore.getState();
    expect(state.isSyncing).toBe(false);
    expect(state.lastSyncAt).toBeTruthy();
    expect(state.syncError).toBeNull();
  });

  it('should set sync error', () => {
    useSyncStore.getState().setSyncing(true);
    useSyncStore.getState().setSyncError('Network error');
    const state = useSyncStore.getState();
    expect(state.isSyncing).toBe(false);
    expect(state.syncError).toBe('Network error');
  });

  it('should clear error when syncing again', () => {
    useSyncStore.getState().setSyncError('Previous error');
    useSyncStore.getState().setSyncing(true);
    const state = useSyncStore.getState();
    expect(state.syncError).toBeNull();
  });
});
