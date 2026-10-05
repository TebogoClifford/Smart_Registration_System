import axios from 'axios';

const API_BASE_URL = 'https://smart-registration-system.onrender.com';

const api = {
  async getDevices() {
    const response = await axios.get(`${API_BASE_URL}/api/devices`);
    return response.data;
  },
  async createDevice(venueId, name) {
    const response = await axios.post(`${API_BASE_URL}/api/devices`, {
      venue_id: venueId,
      name,
    });
    return response.data;
  },
  async createStudent(studentNumber, name, deviceId) {
    const response = await axios.post(`${API_BASE_URL}/api/students`, {
      student_number: studentNumber,
      name,
      device_id: deviceId,
    });
    return response.data;
  },
  async getVenues() {
    const response = await axios.get(`${API_BASE_URL}/api/venues`);
    return response.data;
  },
  async createVenue(venueData) {
    const response = await axios.post(`${API_BASE_URL}/api/venues`, venueData);
    return response.data;
  },
  async getVenue(id) {
    const response = await axios.get(`${API_BASE_URL}/api/venues/${id}`);
    return response.data;
  },
  async getStudents() {
    const response = await axios.get(`${API_BASE_URL}/api/students`);
    return response.data;
  },
  async getStudent(id) {
    const response = await axios.get(`${API_BASE_URL}/api/students/${id}`);
    return response.data;
  },
  async getDevicesByVenue(venueId) {
    const response = await axios.get(`${API_BASE_URL}/api/venues/${venueId}/devices`);
    return response.data;
  },
  async getDevice(id) {
    const response = await axios.get(`${API_BASE_URL}/api/devices/${id}`);
    return response.data;
  },
  async updateVenue(id, name) {
    const response = await axios.put(`${API_BASE_URL}/api/venues/${id}`, { name });
    return response.data;
  },
  async deleteVenue(id) {
    const response = await axios.delete(`${API_BASE_URL}/api/venues/${id}`);
    return response.data;
  },
  async updateDevice(id, venueId, name) {
    const response = await axios.put(`${API_BASE_URL}/api/devices/${id}`, {
      venue_id: venueId,
      name,
    });
    return response.data;
  },
  async deleteDevice(id) {
    const response = await axios.delete(`${API_BASE_URL}/api/devices/${id}`);
    return response.data;
  },
  async updateStudent(id, studentNumber, name, deviceId) {
    const response = await axios.put(`${API_BASE_URL}/api/students/${id}`, {
      student_number: studentNumber,
      name,
      device_id: deviceId,
    });
    return response.data;
  },
  async deleteStudent(id) {
    const response = await axios.delete(`${API_BASE_URL}/api/students/${id}`);
    return response.data;
  },
  async getAccessEvents() {
    const response = await axios.get(`${API_BASE_URL}/api/access-events`);
    return response.data;
  },
  async overrideEvent(eventId, invigilatorId, reason) {
    const response = await axios.post(`${API_BASE_URL}/api/access-events/${eventId}/override`, {
      invigilatorId,
      reason,
    });
    return response.data;
  },
  async getStats() {
    const response = await axios.get(`${API_BASE_URL}/api/stats`);
    return response.data;
  }
};

export { api };