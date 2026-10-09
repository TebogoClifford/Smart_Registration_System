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
        <defs>
          <linearGradient id="srs-brand-gradient" x1="5" y1="5" x2="43" y2="44" gradientUnits="userSpaceOnUse">
            <stop stopColor="#38BDF8" />
            <stop offset="1" stopColor="#1D4ED8" />
          </linearGradient>
        </defs>
        <path d="M24 3.5 41 10v12.3c0 10.2-6.9 17.8-17 22.2C13.9 40.1 7 32.5 7 22.3V10L24 3.5Z" fill="url(#srs-brand-gradient)" fillOpacity=".16" />
        <path d="M24 5.5 39 11v11.2c0 9.2-6.1 16.2-15 20.1-8.9-3.9-15-10.9-15-20.1V11L24 5.5Z" stroke="url(#srs-brand-gradient)" strokeWidth="2.3" />
        <path d="M15.5 17.5c0-1.1.9-2 2-2h12.8c1.1 0 2 .9 2 2v12.8c0 1.1-.9 2-2 2H17.5c-1.1 0-2-.9-2-2V17.5Z" fill="white" fillOpacity=".94" />
        <circle cx="21" cy="21" r="2.5" fill="#2563EB" />
        <path d="M17.8 27c.6-2 1.7-3 3.2-3s2.6 1 3.2 3" stroke="#2563EB" strokeWidth="1.6" strokeLinecap="round" />
        <path d="M26.5 20h3.2M26.5 23.5h3.2M18.2 29.5h11.5" stroke="#0F4CBB" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="33.8" cy="32.2" r="7.2" fill="#0F4CBB" stroke="white" strokeWidth="1.5" />
        <path d="m30.5 32.1 2.2 2.2 4.4-4.7" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        <path d="m15.2 10.3 8.8-4 8.8 4-8.8 4-8.8-4Z" fill="#38BDF8" stroke="white" strokeWidth=".8" strokeLinejoin="round" />
        <path d="M18.2 11.7v2.1c2.7 2 8.9 2 11.6 0v-2.1" stroke="#38BDF8" strokeWidth="1.2" strokeLinecap="round" />
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
