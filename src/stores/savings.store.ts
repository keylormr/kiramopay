import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SavingsGoal {
  id: string;
  name: string;
  target: number;
  saved: number;
  icon: string;
  color: string;
  createdAt: string;
}

interface SavingsState {
  goals: SavingsGoal[];
  addGoal: (goal: SavingsGoal) => void;
  removeGoal: (id: string) => void;
  addToGoal: (id: string, amount: number) => void;
  updateGoal: (id: string, updates: Partial<SavingsGoal>) => void;
  setGoals: (goals: SavingsGoal[]) => void;
}

export const useSavingsStore = create<SavingsState>()(
  persist(
    (set) => ({
      goals: [],

      addGoal: (goal) =>
        set((s) => ({ goals: [...s.goals, goal] })),

      removeGoal: (id) =>
        set((s) => ({ goals: s.goals.filter((g) => g.id !== id) })),

      addToGoal: (id, amount) =>
        set((s) => ({
          goals: s.goals.map((g) =>
            g.id === id ? { ...g, saved: Math.min(g.saved + amount, g.target) } : g,
          ),
        })),

      updateGoal: (id, updates) =>
        set((s) => ({
          goals: s.goals.map((g) => (g.id === id ? { ...g, ...updates } : g)),
        })),

      setGoals: (goals) => set({ goals }),
    }),
    {
      name: 'kiramopay-savings',
    },
  ),
);
