const BASE_URL = import.meta.env.VITE_API_BASE_URL;

async function request(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (res.status === 204) return null; // DELETE success has no body
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return body;
}

export const api = {
  // Venues
  getVenues: () => request('/api/venues'),
  createVenue: (name) => request('/api/venues', { method: 'POST', body: JSON.stringify({ name }) }),
  updateVenue: (id, name) => request(`/api/venues/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  deleteVenue: (id) => request(`/api/venues/${id}`, { method: 'DELETE' }),

  // Devices
  getDevices: () => request('/api/devices'),
  getDevice: (id) => request(`/api/devices/${id}`),
  createDevice: (venue_id, name) =>
    request('/api/devices', { method: 'POST', body: JSON.stringify({ venue_id, name }) }),
  updateDevice: (id, venue_id, name) =>
    request(`/api/devices/${id}`, { method: 'PUT', body: JSON.stringify({ venue_id, name }) }),
  deleteDevice: (id) => request(`/api/devices/${id}`, { method: 'DELETE' }),

  // Students
  getStudents: () => request('/api/students'),
  getStudent: (id) => request(`/api/students/${id}`),
  createStudent: (student_number, name, device_id) =>
    request('/api/students', { method: 'POST', body: JSON.stringify({ student_number, name, device_id }) }),
  updateStudent: (id, student_number, name, device_id) =>
    request(`/api/students/${id}`, { method: 'PUT', body: JSON.stringify({ student_number, name, device_id }) }),
  deleteStudent: (id) => request(`/api/students/${id}`, { method: 'DELETE' }),

  // Access events
  getAccessEvents: () => request('/api/access-events'),
};