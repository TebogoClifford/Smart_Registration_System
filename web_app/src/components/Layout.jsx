import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, MapPin, Users, LogOut, ShieldCheck, ChevronRight, CalendarCheck, KeyRound, UserCog } from 'lucide-react';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import { rememberPage, lastPage } from '@/lib/drafts';

const VERSION = 'v1.2.0-beta';
const initialsOf = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';

// One sidebar entry per section. A section with `tabs` shows them above its pages;
// `match` lists every address that belongs to the section (so /students/12 is still "Students").
const allNavItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, match: [] },
  { path: '/venues', label: 'Venues & Devices', icon: MapPin, match: ['/venues', '/devices'] },
  {
    path: '/students', label: 'Students', icon: Users, match: ['/students', '/enroll', '/modules'],
    tabs: [{ path: '/students', label: 'Student list' }, { path: '/enroll', label: 'Enrolment' }, { path: '/modules', label: 'Modules' }],
  },
  {
    path: '/bookings', label: 'Exam', icon: CalendarCheck, match: ['/bookings', '/calendar'],
    tabs: [{ path: '/bookings', label: 'Exam bookings' }, { path: '/calendar', label: 'Exam calendar' }],
  },
  { path: '/users', label: 'Accounts', icon: KeyRound, adminOnly: true, match: ['/users'] },
  { path: '/account', label: 'My account', icon: UserCog, match: ['/account'] },
];

const under = (pathname, base) => pathname === base || pathname.startsWith(`${base}/`);
const isInSection = (pathname, item) => (item.path === '/' ? pathname === '/' : item.match.some((m) => under(pathname, m)));

// Where a tab or sidebar entry leads: back to the last page you had open there (e.g. the student you
// were editing, with the list's filters), or to its main page when you are already in it.
const target = (key, home, inside) => (inside ? home : lastPage(key) ?? home);

// The tab row of a section (Student list · Enrolment · Modules, or Exam bookings · Exam calendar).
function SectionTabs({ tabs, pathname }) {
  return (
    <nav aria-label="Section tabs" className="mb-5 flex gap-1 overflow-x-auto overflow-y-hidden border-b border-slate-200">
      {tabs.map((t) => {
        const active = under(pathname, t.path);
        return (
          <Link key={t.path} to={target(`tab:${t.path}`, t.path, active)} aria-current={active ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${active ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-800'}`}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

function BrandMark({ small = false }) {
  return (
    <span className={`brand-mark ${small ? 'brand-mark-small' : ''}`} aria-hidden="true">
      <svg viewBox="0 0 48 48" fill="none" role="presentation">
        <rect x="3" y="3" width="42" height="42" rx="12" fill="#102A43" />
        <path d="M15.2 17.1c0-2.1 1.8-3.7 4.3-3.7h9.2c2.3 0 4.1 1.3 4.1 3.4v1.1h-4.4v-.5c0-.5-.4-.8-1-.8h-6.8c-.6 0-1 .3-1 .8v1.1c0 .5.4.8 1 .8h7.7c2.8 0 4.5 1.7 4.5 4.2v3.4c0 2.2-1.8 3.8-4.4 3.8h-9.3c-2.5 0-4.2-1.4-4.2-3.6v-1h4.4v.4c0 .6.4.9 1 .9h6.9c.6 0 1-.3 1-.9v-1.2c0-.5-.4-.8-1-.8h-7.7c-2.7 0-4.3-1.7-4.3-4.2v-3.2Z" fill="#FFFFFF"/>
        <path d="M33.5 29.5 37 33l6-7" stroke="#39C6D6" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M7 12h4M7 17h2" stroke="#39C6D6" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export default function Layout() {
  const location = useLocation();
  const { user, isAdmin, authRequired, logout } = useAuth();
  const navItems = allNavItems.filter((item) => !item.adminOnly || isAdmin);
  const roleLabel = user?.role === 'admin' ? 'Administrator' : 'Invigilator';
  const currentPage = navItems.find((item) => isInSection(location.pathname, item)) || navItems[0];

  // remember the page open in each section and tab (with its ?search), to come back to it later
  const here = location.pathname + location.search;
  useEffect(() => {
    for (const item of allNavItems) {
      if (item.path !== '/' && isInSection(location.pathname, item)) rememberPage(`section:${item.path}`, here);
      for (const t of item.tabs ?? []) if (under(location.pathname, t.path)) rememberPage(`tab:${t.path}`, here);
    }
  }, [location.pathname, here]);

  const renderNavItem = (item) => {
    const Icon = item.icon;
    const isActive = isInSection(location.pathname, item);

    return (
      <Link key={item.path} to={target(`section:${item.path}`, item.path, isActive)} aria-current={isActive ? 'page' : undefined}
        className={`nav-link ${isActive ? 'nav-link-active' : ''}`}>
        <Icon size={18} strokeWidth={isActive ? 2.4 : 2} />
        <span>{item.label}</span>
        {isActive && <ChevronRight className="ml-auto hidden lg:block" size={15} />}
      </Link>
    );
  };

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link to="/" className="brand-lockup" aria-label="SRS Console SMART REGISTRATION home">
          <BrandMark />
          <span className="min-w-0">
            <span className="brand-name">SRS <span>Console</span></span>
            <span className="brand-caption">SMART REGISTRATION</span>
          </span>
        </Link>

        <div className="sidebar-section-label">WORKSPACE</div>
        <nav className="sidebar-nav" aria-label="Main navigation">
          {navItems.map(renderNavItem)}
        </nav>

        <div className="sidebar-bottom">
          <div className="user-card">
            <Link to="/account" className="flex min-w-0 flex-1 items-center gap-3" aria-label="My account">
              <div className="user-avatar">{initialsOf(user?.name)}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-800">{user?.name}</p>
                <p className="text-xs text-slate-500">{roleLabel}</p>
              </div>
            </Link>
            {authRequired && (
              <button type="button" className="signout-button" aria-label="Sign out" onClick={logout}>
                <LogOut size={16} />
              </button>
            )}
          </div>
          <p className="version-label">{VERSION} · Secure workspace</p>
        </div>
      </aside>

      <div className="app-main-column">
        <header className="mobile-brand-bar">
          <Link to="/" className="brand-lockup" aria-label="SRS Console SMART REGISTRATION home">
            <BrandMark small />
            <span className="min-w-0">
              <span className="brand-name">SRS <span>Console</span></span>
              <span className="brand-caption">SMART REGISTRATION</span>
            </span>
          </Link>
          <span className="mobile-user-avatar">{initialsOf(user?.name)}</span>
        </header>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navItems.map(renderNavItem)}
        </nav>

        <main className="app-main">
          <div className="page-topline">
            <div>
              <p className="page-eyebrow">REGISTRATION MANAGEMENT</p>
              <h1 className="page-shell-title">{currentPage.label}</h1>
            </div>
            <div className="secure-pill"><ShieldCheck size={15} /> <span>{roleLabel} workspace</span></div>
          </div>
          {currentPage.tabs && <SectionTabs tabs={currentPage.tabs} pathname={location.pathname} />}
          <Outlet />
          <footer className="app-footer">
            <span>Smart Registration System</span>
            <span className="footer-dot" />
            <span>Access management made clearer.</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
