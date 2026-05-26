import { create } from 'zustand';

interface SyncState {
  isSyncing: boolean;
  lastSyncAt: string | null;
  syncError: string | null;

  setSyncing: (syncing: boolean) => void;
  setSyncComplete: () => void;
  setSyncError: (error: string) => void;
}

export const useSyncStore = create<SyncState>()((set) => ({
  isSyncing: false,
  lastSyncAt: null,
  syncError: null,

  setSyncing: (syncing) => set({ isSyncing: syncing, syncError: null }),

  setSyncComplete: () =>
    set({
      isSyncing: false,
      lastSyncAt: new Date().toISOString(),
      syncError: null,
    }),

  setSyncError: (error) => set({ isSyncing: false, syncError: error }),
}));
