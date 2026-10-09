import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, MapPin, Users, UserPlus, LogOut } from 'lucide-react';

const mockUser = {
  name: "Teboho M.",
  initials: "TM",
  role: "Invigilator",
  version: "v1.1.0-beta"
};

export default function Layout() {
  const location = useLocation();
  const navItems = [
    { path: '/', label: 'Dashboard', icon: <LayoutDashboard size={20} /> },
    { path: '/venues', label: 'Venues & Devices', icon: <MapPin size={20} /> },
    { path: '/students', label: 'Students', icon: <Users size={20} /> },
    { path: '/enroll', label: 'Enrollment', icon: <UserPlus size={20} /> },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r bg-card">
        <div className="border-b p-6">
          <h1 className="text-xl font-bold tracking-tight">SRS Console</h1>
          <p className="text-xs text-muted-foreground">{mockUser.role} Access</p>
        </div>
        <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto p-4" aria-label="Main navigation">
          {navItems.map((item) => {
            const isActive = item.path === '/'
              ? location.pathname === '/'
              : item.path === '/venues'
                ? location.pathname.startsWith('/venues') || location.pathname.startsWith('/devices')
                : location.pathname === item.path || location.pathname.startsWith(`${item.path}/`);
            return (
              <Link key={item.path} to={item.path}
                className={`flex h-[44px] shrink-0 items-center gap-3 rounded-md px-3 py-2 transition-all duration-200 ${isActive
                  ? 'rounded-l-none border-l-4 border-primary bg-primary/10 font-bold text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                {item.icon}<span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="border-t bg-muted/30 p-4">
          <div className="mb-4 flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{mockUser.initials}</div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-sm font-medium">{mockUser.name}</p>
              <button type="button" className="flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-destructive">
                <LogOut size={12} /> Sign out
              </button>
            </div>
          </div>
          <p className="text-center text-[10px] uppercase tracking-wider text-muted-foreground">{mockUser.version}</p>
        </div>
      </aside>
      <main className="flex-1 overflow-auto p-4 sm:p-6 lg:p-8">
        <Outlet />
      </main>
    </div>
  );
}
