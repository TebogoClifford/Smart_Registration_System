import axios from 'axios';

export const TOKEN_KEY = 'srs.token';
export const LOGOUT_EVENT = 'srs:logout';
export const PASSWORD_CHANGE_EVENT = 'srs:password-change-required';

// Set VITE_API_BASE_URL in .env.local to point the app at a local backend; defaults to the Render deployment.
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://smart-registration-system.onrender.com';

// One axios instance for the whole app:
//  * sends the sign-in token (if any) with every request;
//  * turns the server's { error: "..." } into err.message, so toasts show the real reason
//    ("Hall A does not have enough seats...") instead of "Request failed with status code 409";
//  * a 401 on a signed-in session means the token expired -> tell the app to sign out.
const http = axios.create({ baseURL: API_BASE_URL, timeout: 60000 }); // long timeout: Render's free tier sleeps and takes ~30 s to wake

export const getToken = () => { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } };
export const setToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch { /* storage blocked: stay signed in for this page only */ } };

http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});
http.interceptors.response.use(
  (r) => r,
  (err) => {
    const serverMessage = err.response?.data?.error;
    if (serverMessage) err.message = serverMessage;
    else if (!err.response) err.message = 'Cannot reach the server. Check your connection and try again.';
    const isLogin = err.config?.url?.includes('/api/auth/login');
    if (err.response?.status === 401 && getToken() && !isLogin) window.dispatchEvent(new Event(LOGOUT_EVENT));
    // an administrator reset the password while this page was open: show the change-password screen
    if (err.response?.data?.code === 'PASSWORD_CHANGE_REQUIRED') window.dispatchEvent(new Event(PASSWORD_CHANGE_EVENT));
    return Promise.reject(err);
  }
);

const api = {
  async getDevices() {
    const response = await http.get(`/api/devices`);
    return response.data;
  },
  async createDevice(venueId, name) {
    const response = await http.post(`/api/devices`, {
      venue_id: venueId,
      name,
    });
    return response.data;
  },
  async createStudent(studentNumber, name, deviceId, courseName = '', email = '') {
    const response = await http.post(`/api/students`, {
      student_number: studentNumber,
      name,
      email,
      device_id: deviceId,
      course_name: courseName,
    });
    return response.data;
  },
  async getVenues() {
    const response = await http.get(`/api/venues`);
    return response.data;
  },
  async createVenue(venueData) {
    const response = await http.post(`/api/venues`, venueData);
    return response.data;
  },
  async getVenue(id) {
    const response = await http.get(`/api/venues/${id}`);
    return response.data;
  },
  async getStudents() {
    const response = await http.get(`/api/students`);
    return response.data;
  },
  async getStudent(id) {
    const response = await http.get(`/api/students/${id}`);
    return response.data;
  },
  async getDevicesByVenue(venueId) {
    const response = await http.get(`/api/venues/${venueId}/devices`);
    return response.data;
  },
  async getDevice(id) {
    const response = await http.get(`/api/devices/${id}`);
    return response.data;
  },
  async updateVenue(id, name, capacity) {
    const response = await http.put(`/api/venues/${id}`, { name, capacity });
    return response.data;
  },
  async deleteVenue(id) {
    const response = await http.delete(`/api/venues/${id}`);
    return response.data;
  },
  async updateDevice(id, venueId, name) {
    const response = await http.put(`/api/devices/${id}`, {
      venue_id: venueId,
      name,
    });
    return response.data;
  },
  async deleteDevice(id) {
    const response = await http.delete(`/api/devices/${id}`);
    return response.data;
  },
  async updateStudent(id, studentNumber, name, deviceId, courseName = '', email = '') {
    const response = await http.put(`/api/students/${id}`, {
      student_number: studentNumber,
      name,
      email,
      device_id: deviceId,
      course_name: courseName,
    });
    return response.data;
  },
  async deleteStudent(id) {
    const response = await http.delete(`/api/students/${id}`);
    return response.data;
  },
  // Ask the device to capture this student again (sets the status back to 'pending').
  async reEnrollStudent(id) {
    const response = await http.post(`/api/students/${id}/re-enroll`);
    return response.data;
  },
  // params (optional): { from, to, limit } — ISO timestamps; see GET /api/access-events
  async getAccessEvents(params = {}) {
    const response = await http.get(`/api/access-events`, { params });
    return response.data;
  },
  async overrideEvent(eventId, invigilatorId, reason) {
    const response = await http.post(`/api/access-events/${eventId}/override`, {
      invigilatorId,
      reason,
    });
    return response.data;
  },
  // ---- sign-in and accounts
  async getAuthStatus() { return (await http.get('/api/auth/status')).data; },
  async login(email, password) { return (await http.post('/api/auth/login', { email, password })).data; },
  async me() { return (await http.get('/api/auth/me')).data; },
  async changePassword(currentPassword, newPassword) { return (await http.put('/api/auth/password', { currentPassword, newPassword })).data; },
  async updateMe(changes) { return (await http.put('/api/auth/me', changes)).data; },
  async getUsers() { return (await http.get('/api/users')).data; },
  async createUser(user) { return (await http.post('/api/users', user)).data; },
  async updateUser(id, changes) { return (await http.put(`/api/users/${id}`, changes)).data; },
  // returns the account with temporaryPassword (shown once)
  async resetUserPassword(id) { return (await http.post(`/api/users/${id}/reset-password`)).data; },
  async deleteUser(id) { return (await http.delete(`/api/users/${id}`)).data; },
  // ---- modules and exam bookings
  async getModules() { return (await http.get('/api/modules')).data; },
  async createModule(code, name) { return (await http.post('/api/modules', { code, name })).data; },
  async updateModule(id, code, name) { return (await http.put(`/api/modules/${id}`, { code, name })).data; },
  async deleteModule(id) { return (await http.delete(`/api/modules/${id}`)).data; },
  async getModuleStudents(id) { return (await http.get(`/api/modules/${id}/students`)).data; },
  async addModuleStudents(id, studentIds) { return (await http.post(`/api/modules/${id}/students`, { studentIds })).data; },
  async removeModuleStudent(id, studentId) { return (await http.delete(`/api/modules/${id}/students/${studentId}`)).data; },
  async setStudentModules(studentId, moduleIds) { return (await http.put(`/api/students/${studentId}/modules`, { moduleIds })).data; },
  async getBookings(params = {}) { return (await http.get('/api/bookings', { params })).data; },
  async getBooking(id) { return (await http.get(`/api/bookings/${id}`)).data; },
  // per day and session in a date range: can this module sit in this hall then (and why not)
  async getDateAvailability(params) { return (await http.get('/api/bookings/date-availability', { params })).data; },
  async getAvailability(venueId, date, slot) { return (await http.get('/api/bookings/availability', { params: { venueId, date, slot } })).data; },
  async createBooking(moduleId, venueId, date, slot) { return (await http.post('/api/bookings', { moduleId, venueId, date, slot })).data; },
  async cancelBooking(id) { return (await http.delete(`/api/bookings/${id}`)).data; },
  // move a booking to another hall / day / session; the module's students are seated again
  async updateBooking(id, venueId, date, slot) { return (await http.put(`/api/bookings/${id}`, { venueId, date, slot })).data; },
  // ---- exam emails to students (the Email log)
  async getEmails(params = {}) { return (await http.get('/api/emails', { params })).data; },
  async getEmailStatus() { return (await http.get('/api/emails/status')).data; },
  async retryEmails() { return (await http.post('/api/emails/retry')).data; },
  // ---- courses, recognitions and enrolment photos
  async getCourses() { return (await http.get('/api/courses')).data; },
  async getRecognitions(limit = 8) { return (await http.get('/api/access-events/recognitions', { params: { limit } })).data; },
  // the photo needs the sign-in header, so it is fetched as a blob; revoke the URL when done with it
  async getStudentPhotoUrl(id) {
    const response = await http.get(`/api/students/${id}/enrollment-image`, { responseType: 'blob' });
    return URL.createObjectURL(response.data);
  },
  async getStats() {
    const response = await http.get(`/api/stats`);
    return response.data;
  }
};

export { api };