import { Suspense, lazy } from 'react';
import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import HomePage from './pages/HomePage';
import WorkPage from './pages/WorkPage';
import EditWorkPage from './pages/EditWorkPage';
import VersionsPage from './pages/VersionsPage';

const GraphPage = lazy(() => import('./pages/GraphPage')); // cytoscape is heavy — own chunk
import SubmitPage from './pages/SubmitPage';
import ImportPage from './pages/ImportPage';
import ProfilePage from './pages/ProfilePage';
import SettingsPage from './pages/SettingsPage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AboutPage from './pages/AboutPage';
import GovernancePage from './pages/GovernancePage';
import AiTrackRecordPage from './pages/AiTrackRecordPage';
import ReviewComposerPage from './pages/ReviewComposerPage';
import VersionPage from './pages/VersionPage';
import FlagsPage from './pages/FlagsPage';
import ChatsPage from './pages/ChatsPage';
import ChatUploadPage from './pages/ChatUploadPage';
import ChatPage from './pages/ChatPage';

export default function App() {
  return (
    <div className="app-shell">
      <Header />
      <main className="container">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/works/new" element={<SubmitPage />} />
          <Route path="/works/:id" element={<WorkPage />} />
          <Route path="/works/:id/edit" element={<EditWorkPage />} />
          <Route path="/works/:id/versions" element={<VersionsPage />} />
          <Route
            path="/works/:id/graph"
            element={
              <Suspense fallback={<div className="empty-state">Loading graph…</div>}>
                <GraphPage />
              </Suspense>
            }
          />
          <Route path="/works/:id/review" element={<ReviewComposerPage />} />
          <Route
            path="/graph"
            element={
              <Suspense fallback={<div className="empty-state">Loading graph…</div>}>
                <GraphPage />
              </Suspense>
            }
          />
          <Route path="/chats" element={<ChatsPage />} />
          <Route path="/chats/new" element={<ChatUploadPage />} />
          <Route path="/chats/:id" element={<ChatPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/users/:id" element={<ProfilePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/governance" element={<GovernancePage />} />
          <Route path="/flags" element={<FlagsPage />} />
          <Route path="/ai/track-record" element={<AiTrackRecordPage />} />
          <Route path="/versions/:hash" element={<VersionPage />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <div className="container site-footer-inner">
          <p>
            Beyond Papers — a nonprofit, community-governed research graph. Research is never paywalled.
            Platform-generated content is licensed CC-BY-SA 4.0.
          </p>
        </div>
      </footer>
    </div>
  );
}
