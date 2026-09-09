import { Navigate, Route, Routes } from 'react-router-dom';
import { ChatPage } from './pages/ChatPage';
import { SettingsLayout } from './pages/SettingsLayout';
import { ProvidersPage } from './pages/ProvidersPage';
import { McpPage } from './pages/McpPage';
import { SkillsPage } from './pages/SkillsPage';
import { GeneralSettingsPage } from './pages/GeneralSettingsPage';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<ChatPage />} />
      <Route path="/c/:id" element={<ChatPage />} />
      <Route path="/settings" element={<SettingsLayout />}>
        <Route index element={<Navigate to="providers" replace />} />
        <Route path="providers" element={<ProvidersPage />} />
        <Route path="general" element={<GeneralSettingsPage />} />
        <Route path="mcp" element={<McpPage />} />
        <Route path="skills" element={<SkillsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
