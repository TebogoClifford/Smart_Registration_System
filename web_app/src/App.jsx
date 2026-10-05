import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import Layout from './components/Layout';

// Pages (Lazy loaded or imported)
import Dashboard from './pages/Dashboard';
import VenueList from './pages/VenueList';
import VenueDetail from './pages/VenueDetail';
import DeviceList from './pages/DeviceList';
import DeviceDetail from './pages/DeviceDetail';
import StudentList from './pages/StudentList';
import StudentDetail from './pages/StudentDetail';
import Enroll from './pages/Enroll';

export default function App() {
  return (
    <BrowserRouter>
      <div className="app-container">
        <Routes>
          <Route path="/" element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="venues" element={<VenueList />} />
            <Route path="venues/:id" element={<VenueDetail />} />
            <Route path="devices" element={<DeviceList />} />
            <Route path="devices/:id" element={<DeviceDetail />} />
            <Route path="students" element={<StudentList />} />
            <Route path="students/:id" element={<StudentDetail />} />
            <Route path="enroll" element={<Enroll />} />
          </Route>
        </Routes>
      </div>
      <Toaster position="bottom-right" richColors />
    </BrowserRouter>
  );
}
