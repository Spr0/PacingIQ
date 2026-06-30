import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { ROLE_ORDER, ROLES } from '../lib/permissions.js';

const NAV = [
  { to: '/', label: 'Dashboard', icon: '◧', end: true },
  { to: '/teachers', label: 'Teachers', icon: '◎' },
  { to: '/observations', label: 'Observations', icon: '✎' },
  { to: '/pacing', label: 'Pacing', icon: '⟳' },
  { to: '/interventions', label: 'Interventions', icon: '◆' },
  { to: '/report', label: 'Impact Report', icon: '▤' },
  { to: '/audit', label: 'Audit Log', icon: '⏿' },
];

const TITLES = {
  '/': ['Dashboard', 'Weekly instructional intelligence'],
  '/teachers': ['Teachers', 'Roster and individual records'],
  '/observations': ['Observations', 'Classroom visits and feedback'],
  '/pacing': ['Pacing', 'Weekly pacing status and exceptions'],
  '/interventions': ['Interventions', 'Cases, action plans, and follow-up'],
  '/report': ['Coaching Impact Report', 'Single-page school health view'],
  '/audit': ['Audit Log', 'Activity and change history'],
};

export default function Layout() {
  const { user, roleKey, setRole } = useApp();
  const { pathname } = useLocation();

  const base = '/' + (pathname.split('/')[1] || '');
  const [title, subtitle] = TITLES[base] || TITLES['/'];

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__brand">
          <span className="mark">P</span>
          <span>
            PacingIQ
            <small>Coaching Intelligence</small>
          </span>
        </div>
        <nav className="nav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="nav__icon">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          Demo prototype · localStorage
          <br />
          Re-platforms to MS Copilot
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar__title">
            {title}
            <small>{subtitle}</small>
          </div>
          <div className="roleswitch">
            <div className="roleswitch__pills" role="tablist" aria-label="Switch role">
              {ROLE_ORDER.map((key) => (
                <button
                  key={key}
                  className={roleKey === key ? 'active' : ''}
                  onClick={() => setRole(key)}
                  title={ROLES[key].name}
                >
                  {ROLES[key].label}
                </button>
              ))}
            </div>
            <div className="avatar" title={`${user.name} · ${user.label}`}>
              {user.initials}
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
