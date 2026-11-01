import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import Layout from './components/Layout';
import AuthProvider from './components/AuthProvider';
import { useAuth } from './lib/auth';

// Each page is downloaded only when it is first opened, so the first visit loads much less.
// After a new deploy an open tab may ask for page files that no longer exist: reload once to get the new ones.
const lazyPage = (load) => lazy(() => load().catch((err) => {
  try {
    if (!sessionStorage.getItem('srs.reloadedForUpdate')) { sessionStorage.setItem('srs.reloadedForUpdate', '1'); window.location.reload(); }
  } catch { /* storage blocked: just show the error */ }
  throw err;
}));
const Dashboard = lazyPage(() => import('./pages/Dashboard'));
const VenueDeviceManagement = lazyPage(() => import('./pages/VenueDeviceManagement'));
const VenueDetail = lazyPage(() => import('./pages/VenueDetail'));
const DeviceDetail = lazyPage(() => import('./pages/DeviceDetail'));
const StudentList = lazyPage(() => import('./pages/StudentList'));
const StudentDetail = lazyPage(() => import('./pages/StudentDetail'));
const Enroll = lazyPage(() => import('./pages/Enroll'));
const Modules = lazyPage(() => import('./pages/Modules'));
const Bookings = lazyPage(() => import('./pages/Bookings'));
const ExamCalendar = lazyPage(() => import('./pages/ExamCalendar'));
const EmailLog = lazyPage(() => import('./pages/EmailLog'));
const Users = lazyPage(() => import('./pages/Users'));
const Account = lazyPage(() => import('./pages/Account'));
import Login from './pages/Login';
import ForcePasswordChange from './pages/ForcePasswordChange';

// Shows the sign-in page until the server says we are signed in (or sign-in is switched off).
function Gate({ children }) {
  const { ready, signedIn, mustChangePassword, startupError, retry } = useAuth();
  if (startupError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="max-w-md text-sm text-muted-foreground">{startupError}</p>
        <button type="button" onClick={retry} className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground">Try again</button>
      </div>
    );
  }
  if (!ready) return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Connecting to the server…</div>;

  // Force redirect to /login if not signed in, and to the password screen while the password is temporary
  if (!signedIn) return <Login />;
  return mustChangePassword ? <ForcePasswordChange /> : children;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Gate>
          <div className="app-container">
            <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Loading…</div>}>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route index element={<Dashboard />} />
                <Route path="venues" element={<VenueDeviceManagement />} />
                <Route path="venues/:id" element={<VenueDetail />} />
                <Route path="devices" element={<Navigate to="/venues?tab=devices" replace />} />
                <Route path="devices/:id" element={<DeviceDetail />} />
                <Route path="students" element={<StudentList />} />
                <Route path="students/:id" element={<StudentDetail />} />
                <Route path="enroll" element={<Enroll />} />
                <Route path="modules" element={<Modules />} />
                <Route path="bookings" element={<Bookings />} />
                <Route path="calendar" element={<ExamCalendar />} />
                <Route path="emails" element={<EmailLog />} />
                <Route path="users" element={<Users />} />
                <Route path="account" element={<Account />} />
              </Route>
            </Routes>
            </Suspense>
          </div>
        </Gate>
      </AuthProvider>
      <Toaster position="bottom-right" richColors />
    </BrowserRouter>
  );
}
