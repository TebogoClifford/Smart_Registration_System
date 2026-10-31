import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import Layout from './components/Layout';
import AuthProvider from './components/AuthProvider';
import { useAuth } from './lib/auth';

import Dashboard from './pages/Dashboard';
import VenueDeviceManagement from './pages/VenueDeviceManagement';
import VenueDetail from './pages/VenueDetail';
import DeviceDetail from './pages/DeviceDetail';
import StudentList from './pages/StudentList';
import StudentDetail from './pages/StudentDetail';
import Enroll from './pages/Enroll';
import Modules from './pages/Modules';
import Bookings from './pages/Bookings';
import ExamCalendar from './pages/ExamCalendar';
import Users from './pages/Users';
import Login from './pages/Login';
import Account from './pages/Account';
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
                <Route path="users" element={<Users />} />
                <Route path="account" element={<Account />} />
              </Route>
            </Routes>
          </div>
        </Gate>
      </AuthProvider>
      <Toaster position="bottom-right" richColors />
    </BrowserRouter>
  );
}
