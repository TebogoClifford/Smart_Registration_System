# Frontend-to-Backend Connection Guide

This document describes how the React frontend communicates with the Node.js/Express backend for the Smart Registration System.

## 1. Communication Layer
The frontend uses a centralized API client located at `src/lib/api.js`. 
- **Base URL:** Configured via the environment variable `VITE_API_BASE_URL`.
- **Format:** All data is exchanged as JSON over HTTP.
- **Error Handling:** The API client extracts the `error` field from the backend response and throws it as a JavaScript `Error`, which is then caught by page components and displayed as a `sonner` toast notification.

## 2. Route Mapping

| Frontend Page | Action | API Method | Backend Endpoint | Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Dashboard** | Load Feed | `getAccessEvents` | `GET /api/access-events` | Polls every 5s for live logs |
| **Venues** | List Venues | `getVenues` | `GET /api/venues` | Fetch all venues |
| | Add Venue | `createVenue` | `POST /api/venues` | Create new venue |
| **Venue Detail** | Edit Name | `updateVenue` | `PUT /api/venues/:id` | Update venue name |
| | Delete | `deleteVenue` | `DELETE /api/venues/:id` | Delete (blocked if devices exist) |
| **Devices** | List Devices | `getDevices` | `GET /api/devices` | Fetch all devices |
| | Add Device | `createDevice` | `POST /api/devices` | Assign device to venue |
| **Device Detail** | Edit Name | `updateDevice` | `PUT /api/devices/:id` | Update device metadata |
| | Delete | `deleteDevice` | `DELETE /api/devices/:id` | Delete (blocked if students exist) |
| **Students** | List Students | `getStudents` | `GET /api/students` | Fetch all student records |
| **Student Detail** | Edit Info | `updateStudent` | `PUT /api/students/:id` | Update student details |
| | Delete | `deleteStudent` | `DELETE /api/students/:id` | Remove student record |
| **Enroll** | Initialize | `createStudent` | `POST /api/students` | Create 'pending' student record |

## 3. Key Logic Flows

### Block-on-Delete Pattern
1. **UI:** User clicks "Confirm Delete" $\rightarrow$ `api.deleteVenue(id)`.
2. **Backend:** Checks database for dependent records (e.g., devices assigned to venue).
3. **Response:** If dependents exist, backend returns `409 Conflict` with `{"error": "Cannot delete venue: X device(s) still assigned"}`.
4. **UI:** Frontend catches error $\rightarrow$ `toast.error(err.message)` $\rightarrow$ User sees the specific reason.

### Live Polling Pattern
1. **Component:** `Dashboard.jsx` uses `useEffect` with `setInterval`.
2. **Action:** Every 5000ms, `api.getAccessEvents()` is called.
3. **UI:** State is updated, and the table re-renders with new access logs and color-coded status badges.
