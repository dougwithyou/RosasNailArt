const { getSupabase } = require('../lib/supabase');
const { zonedTimeToUtc } = require('../lib/timezone');
const {
  TIMEZONE,
  BUFFER_MINUTES,
  MIN_NOTICE_MINUTES,
  BOOKING_HORIZON_DAYS,
  PENDING_HOLD_MINUTES,
  SLOT_STEP_MINUTES,
} = require('../lib/business-hours');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseTimeParts(timeStr) {
  const [hour, minute] = timeStr.split(':').map((n) => parseInt(n, 10));
  return { hour, minute };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { date, durationMinutes } = req.query;
  const duration = parseInt(durationMinutes, 10);

  if (!date || !DATE_RE.test(date) || !duration || duration <= 0) {
    res.status(400).json({ error: 'Parámetros inválidos' });
    return;
  }

  const now = new Date();
  const dayStart = zonedTimeToUtc(date, 0, 0, TIMEZONE);
  const horizonEnd = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60000);
  if (dayStart > horizonEnd) {
    res.status(200).json({ slots: [] });
    return;
  }

  const supabase = getSupabase();

  const { data: blocked, error: blockedError } = await supabase
    .from('blocked_dates')
    .select('date')
    .eq('date', date)
    .maybeSingle();

  if (blockedError) {
    res.status(500).json({ error: 'No se pudo verificar disponibilidad' });
    return;
  }
  if (blocked) {
    res.status(200).json({ slots: [] });
    return;
  }

  // Days are closed by default — only windows Maribel explicitly opened count.
  const { data: openSlots, error: openSlotsError } = await supabase
    .from('open_slots')
    .select('start_time, end_time')
    .eq('date', date);

  if (openSlotsError) {
    res.status(500).json({ error: 'No se pudo verificar disponibilidad' });
    return;
  }
  if (!openSlots || openSlots.length === 0) {
    res.status(200).json({ slots: [] });
    return;
  }

  const pendingCutoff = new Date(now.getTime() - PENDING_HOLD_MINUTES * 60000).toISOString();

  // Bound the busy-appointments query to the day's full open window.
  const windowStart = openSlots.reduce((min, w) => (w.start_time < min ? w.start_time : min), openSlots[0].start_time);
  const windowEnd = openSlots.reduce((max, w) => (w.end_time > max ? w.end_time : max), openSlots[0].end_time);
  const { hour: minH, minute: minM } = parseTimeParts(windowStart);
  const { hour: maxH, minute: maxM } = parseTimeParts(windowEnd);
  const dayOpenAt = zonedTimeToUtc(date, minH, minM, TIMEZONE);
  const dayCloseAt = zonedTimeToUtc(date, maxH, maxM, TIMEZONE);

  const { data: busy, error: busyError } = await supabase
    .from('appointments')
    .select('start_at, end_at, status, created_at')
    .lt('start_at', dayCloseAt.toISOString())
    .gt('end_at', dayOpenAt.toISOString())
    .or(`status.eq.confirmed,and(status.eq.pending_payment,created_at.gte.${pendingCutoff})`);

  if (busyError) {
    res.status(500).json({ error: 'No se pudo verificar disponibilidad' });
    return;
  }

  const busyIntervals = (busy || []).map((a) => ({
    start: new Date(a.start_at).getTime() - BUFFER_MINUTES * 60000,
    end: new Date(a.end_at).getTime() + BUFFER_MINUTES * 60000,
  }));

  const earliestStart = new Date(now.getTime() + MIN_NOTICE_MINUTES * 60000);
  const slotSet = new Set();
  const slots = [];

  for (const window of openSlots) {
    const { hour: openH, minute: openM } = parseTimeParts(window.start_time);
    const { hour: closeH, minute: closeM } = parseTimeParts(window.end_time);
    const openAt = zonedTimeToUtc(date, openH, openM, TIMEZONE);
    const closeAt = zonedTimeToUtc(date, closeH, closeM, TIMEZONE);

    for (
      let t = openAt.getTime();
      t + duration * 60000 <= closeAt.getTime();
      t += SLOT_STEP_MINUTES * 60000
    ) {
      const slotStart = t;
      const slotEnd = t + duration * 60000;
      if (slotStart < earliestStart.getTime()) continue;

      const overlaps = busyIntervals.some((b) => slotStart < b.end && slotEnd > b.start);
      if (overlaps) continue;

      const iso = new Date(slotStart).toISOString();
      if (!slotSet.has(iso)) {
        slotSet.add(iso);
        slots.push(iso);
      }
    }
  }

  slots.sort();
  res.status(200).json({ slots });
};
