import { Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useAuth } from '../auth';

export default function Header() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(`/?q=${encodeURIComponent(q)}`);
  };

  return (
    <header className="site-header">
      <div className="container site-header-inner">
        <Link to="/" className="site-logo">
          Beyond<span>Papers</span>
        </Link>
        <form className="header-search" onSubmit={submitSearch} role="search">
          <input
            type="search"
            placeholder="Search works…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search works"
          />
        </form>
        <nav className="site-nav">
          <Link to="/graph">Graph</Link>
          <Link to="/chats">Chats</Link>
          <Link to="/works/new">Submit</Link>
          <Link to="/import">Import</Link>
          <Link to="/ai/track-record">AI record</Link>
          <Link to="/about">About</Link>
          {user ? (
            <>
              <Link to={`/users/${user.id}`}>{user.display_name}</Link>
              <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>
                Log out
              </button>
            </>
          ) : (
            <>
              <Link to="/login">Log in</Link>
              <Link to="/register" className="btn btn-primary btn-sm">
                Join
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
