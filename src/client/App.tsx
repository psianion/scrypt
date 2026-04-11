import { BrowserRouter, Routes, Route } from "react-router";
import { Sidebar } from "./components/Sidebar";
import { TabBar } from "./components/TabBar";
import { StatusBar } from "./components/StatusBar";
import { CommandPalette } from "./components/CommandPalette";
import { Editor } from "./views/Editor";
import { GraphView } from "./views/GraphView";
import { JournalView } from "./views/JournalView";
import { SearchView } from "./views/SearchView";
import { BacklinksPanel } from "./views/BacklinksPanel";
import { KanbanView } from "./views/KanbanView";
import { DataExplorer } from "./views/DataExplorer";
import { TagBrowser } from "./views/TagBrowser";
import { Settings } from "./views/Settings";
import { useStore } from "./store";

export function App() {
  const commandPaletteOpen = useStore((s) => s.commandPaletteOpen);
  return (
    <BrowserRouter>
      <div className="flex h-screen w-screen overflow-hidden">
        <Sidebar />
        <div className="flex flex-col flex-1 min-w-0">
          <TabBar />
          <main className="flex flex-1 min-h-0">
            <div className="flex-1 min-w-0">
              <Routes>
                <Route path="/" element={<JournalView />} />
                <Route path="/note/*" element={<Editor />} />
                <Route path="/graph" element={<GraphView />} />
                <Route path="/journal" element={<JournalView />} />
                <Route path="/search" element={<SearchView />} />
                <Route path="/tasks" element={<KanbanView />} />
                <Route path="/data" element={<DataExplorer />} />
                <Route path="/tags" element={<TagBrowser />} />
                <Route path="/settings" element={<Settings />} />
              </Routes>
            </div>
            <BacklinksPanel />
          </main>
          <StatusBar />
        </div>
      </div>
      {commandPaletteOpen && <CommandPalette />}
    </BrowserRouter>
  );
}
