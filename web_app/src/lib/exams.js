// Helpers shared by the exam calendar and the dashboard's exam hall bookings.

// YYYY-MM-DD in the browser's own time zone (toISOString would use UTC and can be a day off).
export const localDate = (date = new Date()) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// A YYYY-MM-DD string as a local Date at noon (noon keeps day arithmetic clear of DST edges).
export const parseDate = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d, 12); };
export const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };

export const formatDay = (s, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => parseDate(s).toLocaleDateString(undefined, opts);

// One colour per hall, so the same hall looks the same everywhere.
const HALL_COLOURS = [
  'border-blue-200 bg-blue-50 text-blue-800',
  'border-emerald-200 bg-emerald-50 text-emerald-800',
  'border-violet-200 bg-violet-50 text-violet-800',
  'border-amber-200 bg-amber-50 text-amber-900',
  'border-rose-200 bg-rose-50 text-rose-800',
  'border-cyan-200 bg-cyan-50 text-cyan-800',
];
export const hallColour = (venueId) => HALL_COLOURS[(Number(venueId) || 0) % HALL_COLOURS.length];

// Bookings (one per module) grouped into sittings: one hall, one day, one session, with every module in it.
// Sorted by date, then session, then hall.
export function groupSittings(bookings) {
  const map = new Map();
  for (const b of bookings) {
    const key = `${b.exam_date}|${b.slot}|${b.venue_id}`;
    if (!map.has(key)) {
      map.set(key, { key, date: b.exam_date, slot: b.slot, venueId: b.venue_id, venueName: b.venue_name, capacity: b.venue_capacity, reserved: b.slot_reserved, modules: [] });
    }
    map.get(key).modules.push({ id: b.id, code: b.module_code, name: b.module_name, seats: b.seats });
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot) || a.venueName.localeCompare(b.venueName));
}
