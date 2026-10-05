import React from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { LayoutDashboard, MapPin, Cpu, Users, UserPlus, LogOut } from 'lucide-react';

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
    { path: '/venues', label: 'Venues', icon: <MapPin size={20} /> },
    { path: '/devices', label: 'Devices', icon: <Cpu size={20} /> },
    { path: '/students', label: 'Students', icon: <Users size={20} /> },
    { path: '/enroll', label: 'Enroll', icon: <UserPlus size={20} /> },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-64 border-r bg-card flex flex-col">
        <div className="p-6 border-b">
          <h1 className="text-xl font-bold tracking-tight">SRS Console</h1>
          <p className="text-xs text-muted-foreground">{mockUser.role} Access</p>
        </div>
        <nav className="flex-1 p-4 space-y-1">
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={`flex items-center gap-3 px-3 py-2 rounded-md transition-all duration-200 h-[44px] ${
                  isActive
                    ? 'bg-primary/10 text-primary font-bold border-l-4 border-primary rounded-l-none'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                {item.icon}
                <span className="text-sm">{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="p-4 border-t bg-muted/30">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-bold">
              {mockUser.initials}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="text-sm font-medium truncate">{mockUser.name}</p>
              <button className="text-xs text-muted-foreground hover:text-destructive flex items-center gap-1 transition-colors">
                <LogOut size={12} /> Sign out
              </button>
            </div>
          </div>
          <p className="text-[10px] text-center text-muted-foreground uppercase tracking-wider">
            {mockUser.version}
          </p>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 overflow-auto p-8">
        <Outlet />
      </main>
    </div>
  );
}
