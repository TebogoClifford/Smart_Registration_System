import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, MapPin, Users, UserPlus, LogOut, ShieldCheck, ChevronRight, Sparkles } from 'lucide-react';

const mockUser = {
  name: 'Teboho M.',
  initials: 'TM',
  role: 'Invigilator',
  version: 'v1.1.0-beta',
};

const navItems = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard },
  { path: '/venues', label: 'Venues & Devices', icon: MapPin },
  { path: '/students', label: 'Students', icon: Users },
  { path: '/enroll', label: 'Enrollment', icon: UserPlus },
];

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
  const currentPage = navItems.find((item) => item.path === '/'
    ? location.pathname === '/'
    : item.path === '/venues'
      ? location.pathname.startsWith('/venues') || location.pathname.startsWith('/devices')
      : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`)) || navItems[0];

  const renderNavItem = (item) => {
    const Icon = item.icon;
    const isActive = item.path === '/'
      ? location.pathname === '/'
      : item.path === '/venues'
        ? location.pathname.startsWith('/venues') || location.pathname.startsWith('/devices')
        : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);

    return (
      <Link key={item.path} to={item.path} aria-current={isActive ? 'page' : undefined}
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
        <Link to="/" className="brand-lockup" aria-label="SRS Console home">
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
          <div className="sidebar-tip">
            <span className="tip-icon"><Sparkles size={16} /></span>
            <p className="text-sm font-semibold">Stay in control</p>
            <p className="mt-1 text-xs leading-relaxed text-slate-500">Manage access, venues and enrolments from one place.</p>
          </div>
          <div className="user-card">
            <div className="user-avatar">{mockUser.initials}</div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-800">{mockUser.name}</p>
              <p className="text-xs text-slate-500">{mockUser.role}</p>
            </div>
            <button type="button" className="signout-button" aria-label="Sign out">
              <LogOut size={16} />
            </button>
          </div>
          <p className="version-label">{mockUser.version} · Secure workspace</p>
        </div>
      </aside>

      <div className="app-main-column">
        <header className="mobile-brand-bar">
          <Link to="/" className="brand-lockup" aria-label="SRS Console home">
            <BrandMark small />
            <span className="min-w-0">
              <span className="brand-name">SRS <span>Console</span></span>
              <span className="brand-caption">SMART REGISTRATION</span>
            </span>
          </Link>
          <span className="mobile-user-avatar">{mockUser.initials}</span>
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
            <div className="secure-pill"><ShieldCheck size={15} /> <span>Admin workspace</span></div>
          </div>
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
