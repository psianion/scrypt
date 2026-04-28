import { useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";
import { NewNoteModal } from "./components/NewNoteModal";
import { Editor } from "./views/Editor";
import { GraphView } from "./views/GraphView";
import { JournalView } from "./views/JournalView";
import { NotesList } from "./views/NotesList";
import { SearchView } from "./views/SearchView";
import { TasksList } from "./views/TasksList";
import { DataExplorer } from "./views/DataExplorer";
import { TagBrowser } from "./views/TagBrowser";
import { Settings } from "./views/Settings";
import { DesignSystem } from "./views/design-system/DesignSystem";
import { useStore } from "./store";
import { useApplyTheme } from "./theme";
import { connectWebSocket } from "./api";
import { ToastRegion } from "./ui/Toast";

export function AppContent() {
  useApplyTheme();
  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  const toggleCommandPalette = useStore((s) => s.toggleCommandPalette);
  const [newNoteOpen, setNewNoteOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        toggleCommandPalette();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "n") {
        e.preventDefault();
        setNewNoteOpen(true);
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      if (e.key !== "l" && e.key !== "L") return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) {
        return;
      }
      e.preventDefault();
      useStore.getState().toggleTheme();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  useEffect(() => {
    // Single app-level WebSocket. connectWebSocket routes vault:embedding
    // frames into the embedding-progress store (driving ActivityStrip +
    // CodeMirror overlay + GraphView node pulses) and forwards all other
    // frames to the caller.
    connectWebSocket(() => {});
  }, []);

  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar onNewNote={() => setNewNoteOpen(true)} />
        <div className="flex flex-col flex-1 min-w-0">
          <TabBar />
          <main className="flex flex-1 min-h-0">
            <div className="flex-1 min-w-0">
              <Routes>
                <Route path="/" element={<Navigate to="/journal" replace />} />
                <Route path="/note/*" element={<Editor />} />
                <Route path="/graph" element={<GraphView />} />
                <Route path="/journal" element={<JournalView />} />
                <Route path="/notes" element={<NotesList />} />
                <Route path="/search" element={<SearchView />} />
                <Route path="/tasks" element={<TasksList />} />
                <Route path="/data" element={<DataExplorer />} />
                <Route path="/tags" element={<TagBrowser />} />
                <Route path="/design-system" element={<DesignSystem />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </div>
          </main>
          <StatusBar />
        </div>
      </div>
      {commandPaletteOpen && <CommandPalette />}
      <NewNoteModal open={newNoteOpen} onClose={() => setNewNoteOpen(false)} />
      <ToastRegion />
    </>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}
