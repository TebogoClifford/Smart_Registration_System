import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
import Layout from './components/Layout';

import Dashboard from './pages/Dashboard';
import VenueDeviceManagement from './pages/VenueDeviceManagement';
import VenueDetail from './pages/VenueDetail';
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
            <Route path="venues" element={<VenueDeviceManagement />} />
            <Route path="venues/:id" element={<VenueDetail />} />
            <Route path="devices" element={<Navigate to="/venues?tab=devices" replace />} />
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
