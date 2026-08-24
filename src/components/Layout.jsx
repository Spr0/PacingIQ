import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';
import { useAuth } from '../state/AuthContext.jsx';
import { Icon, Brandmark } from './icons.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: 'dashboard', end: true },
  { to: '/teachers', label: 'Teachers', icon: 'teachers' },
  { to: '/observations', label: 'Observations', icon: 'observations' },
  { to: '/pacing', label: 'Pacing', icon: 'pacing' },
  { to: '/interventions', label: 'Interventions', icon: 'interventions' },
  { to: '/report', label: 'Impact Report', icon: 'report' },
  { to: '/weekly', label: 'Weekly Email', icon: 'mail' },
  { to: '/audit', label: 'Audit Log', icon: 'audit' },
];

const TITLES = {
  '/teachers': ['Teachers', 'Roster and individual records'],
  '/observations': ['Observations', 'Classroom visits and feedback'],
  '/pacing': ['Pacing', 'Weekly pacing status and exceptions'],
  '/interventions': ['Interventions', 'Cases, action plans, and follow-up'],
  '/report': ['Coaching Impact Report', 'Single-page school health view'],
  '/weekly': ['Weekly Email', 'Tuesday coach intelligence digest'],
  '/audit': ['Audit Log', 'Activity and change history'],
};

function dashboardSubtitle() {
  const d = new Date();
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  return `${day} · Spring semester`;
}

export default function Layout() {
  const { user, interventions } = useApp();
  const { signOut } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [q, setQ] = useState('');

  const base = '/' + (pathname.split('/')[1] || '');
  const [title, subtitle] =
    base === '/' ? ['Dashboard', dashboardSubtitle()] : TITLES[base] || ['Dashboard', dashboardSubtitle()];

  const openInterventions = interventions.filter((i) => i.status !== 'Complete').length;

  function onSearch(e) {
    if (e.key === 'Enter') {
      const term = q.trim();
      navigate(term ? `/teachers?q=${encodeURIComponent(term)}` : '/teachers');
    }
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="brandmark">
            <Brandmark />
          </span>
          <span className="name">
            Sierra <b>Rams</b>
            <small>Coaching Intelligence</small>
          </span>
        </div>

        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav__icon">
                <Icon name={n.icon} />
              </span>
              {n.label}
              {n.icon === 'interventions' && openInterventions > 0 && (
                <span className="nav__badge">{openInterventions}</span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar__user">
          <span className="avatar" title={user.name}>
            {user.initials}
          </span>
          <span>
            <span className="name" style={{ display: 'block' }}>
              {user.name}
            </span>
            <span className="role">{user.label}</span>
          </span>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">
            {title}
            <small>{subtitle}</small>
          </div>
          <div className="topbar__actions">
            <label className="search">
              <Icon name="search" />
              <input
                placeholder="Search teachers..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onSearch}
                aria-label="Search teachers"
              />
            </label>
            <div className="roleswitch">
              <div className="roleswitch__pills">
                <button className="active" title={user.name} disabled>
                  {user.label}
                </button>
                <button onClick={signOut}>Sign out</button>
              </div>
            </div>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
