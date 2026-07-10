import { Routes, Route } from 'react-router-dom';
import Header from './components/Header';
import HomePage from './pages/HomePage';
import WorkPage from './pages/WorkPage';
import GraphPage from './pages/GraphPage';
import SubmitPage from './pages/SubmitPage';
import ImportPage from './pages/ImportPage';
import ProfilePage from './pages/ProfilePage';
import LoginPage from './pages/LoginPage';
import RegisterPage from './pages/RegisterPage';
import AboutPage from './pages/AboutPage';
import AiTrackRecordPage from './pages/AiTrackRecordPage';
import ReviewComposerPage from './pages/ReviewComposerPage';
import VersionPage from './pages/VersionPage';

export default function App() {
  return (
    <div className="app-shell">
      <Header />
      <main className="container">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/works/:id" element={<WorkPage />} />
          <Route path="/works/:id/review" element={<ReviewComposerPage />} />
          <Route path="/graph/:id" element={<GraphPage />} />
          <Route path="/submit" element={<SubmitPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/users/:id" element={<ProfilePage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/about" element={<AboutPage />} />
          <Route path="/ai-track-record" element={<AiTrackRecordPage />} />
          <Route path="/versions/:hash" element={<VersionPage />} />
        </Routes>
      </main>
      <footer className="site-footer">
        <div className="container">
          <p>
            Beyond Papers — a nonprofit, community-governed research graph. Research is never paywalled.
            Platform-generated content is licensed CC-BY-SA 4.0.
          </p>
        </div>
      </footer>
    </div>
  );
}
