import { create } from 'zustand';

interface Workspace {
  id: string;
  name: string;
  kind: 'personal' | 'corporate';
  vat_registered: boolean;
}

interface WorkspaceState {
  active: Workspace | null;
  list: Workspace[];
  setActive: (w: Workspace) => void;
  setList: (l: Workspace[]) => void;
  clear: () => void;
}

export const useWorkspace = create<WorkspaceState>((set) => ({
  active: null,
  list: [],
  setActive: (w) => set({ active: w }),
  setList: (l) =>
    set((s) => ({
      list: l,
      // If no active workspace yet, default to the first one
      active: s.active ?? l[0] ?? null,
    })),
  clear: () => set({ active: null, list: [] }),
}));
