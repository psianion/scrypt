// src/client/store.ts
import { create } from "zustand";
import type { NoteMeta, Note, SearchResult, Task } from "../shared/types";

interface Tab {
  path: string;
  title: string;
}

interface AppState {
  // Sidebar
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;

  // Notes list
  notes: NoteMeta[];
  setNotes: (notes: NoteMeta[]) => void;

  // Tabs
  tabs: Tab[];
  activeTab: string | null;
  openTab: (path: string, title: string) => void;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;

  // Current note
  currentNote: Note | null;
  setCurrentNote: (note: Note | null) => void;

  // Search
  searchResults: SearchResult[];
  setSearchResults: (results: SearchResult[]) => void;

  // Command palette
  commandPaletteOpen: boolean;
  toggleCommandPalette: () => void;

  // Tasks
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;

  // Tags
  tags: { tag: string; count: number }[];
  setTags: (tags: { tag: string; count: number }[]) => void;
}

export const useStore = create<AppState>((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  notes: [],
  setNotes: (notes) => set({ notes }),

  tabs: [],
  activeTab: null,
  openTab: (path, title) =>
    set((s) => {
      const exists = s.tabs.find((t) => t.path === path);
      if (exists) return { activeTab: path };
      return { tabs: [...s.tabs, { path, title }], activeTab: path };
    }),
  closeTab: (path) =>
    set((s) => {
      const tabs = s.tabs.filter((t) => t.path !== path);
      const activeTab =
        s.activeTab === path
          ? tabs[tabs.length - 1]?.path || null
          : s.activeTab;
      return { tabs, activeTab };
    }),
  setActiveTab: (path) => set({ activeTab: path }),

  currentNote: null,
  setCurrentNote: (note) => set({ currentNote: note }),

  searchResults: [],
  setSearchResults: (results) => set({ searchResults: results }),

  commandPaletteOpen: false,
  toggleCommandPalette: () =>
    set((s) => ({ commandPaletteOpen: !s.commandPaletteOpen })),


  tasks: [],
  setTasks: (tasks) => set({ tasks }),

  tags: [],
  setTags: (tags) => set({ tags }),
}));
