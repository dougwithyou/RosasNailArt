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
const MAX_RANGE_DAYS = 62;

function parseTimeParts(timeStr) {
  const [hour, minute] = timeStr.split(':').map((n) => parseInt(n, 10));
  return { hour, minute };
}

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Tells the booking calendar which days in a range have at least one
// bookable slot, so it can grey out days that are closed or fully booked
// without the client having to probe /api/availability day by day.
module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { from, to, durationMinutes } = req.query;
  const duration = parseInt(durationMinutes, 10);

  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to) || from > to || !duration || duration <= 0) {
    res.status(400).json({ error: 'Parámetros inválidos' });
    return;
  }

  const dayCount = (new Date(`${to}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86400000 + 1;
  if (dayCount > MAX_RANGE_DAYS) {
    res.status(400).json({ error: 'Rango demasiado grande' });
    return;
  }

  const supabase = getSupabase();
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60000);
  const earliestStart = new Date(now.getTime() + MIN_NOTICE_MINUTES * 60000);
  const pendingCutoff = new Date(now.getTime() - PENDING_HOLD_MINUTES * 60000).toISOString();

  const [{ data: blocked, error: blockedError }, { data: openSlots, error: openSlotsError }, { data: busy, error: busyError }] =
    await Promise.all([
      supabase.from('blocked_dates').select('date').gte('date', from).lte('date', to),
      supabase.from('open_slots').select('date, start_time, end_time').gte('date', from).lte('date', to),
      supabase
        .from('appointments')
        .select('start_at, end_at')
        .lt('start_at', zonedTimeToUtc(addDays(to, 1), 0, 0, TIMEZONE).toISOString())
        .gt('end_at', zonedTimeToUtc(from, 0, 0, TIMEZONE).toISOString())
        .or(`status.eq.confirmed,and(status.eq.pending_payment,created_at.gte.${pendingCutoff})`),
    ]);

  if (blockedError || openSlotsError || busyError) {
    res.status(500).json({ error: 'No se pudo verificar disponibilidad' });
    return;
  }

  const blockedSet = new Set((blocked || []).map((b) => b.date));
  const openByDate = {};
  (openSlots || []).forEach((s) => {
    (openByDate[s.date] = openByDate[s.date] || []).push(s);
  });
  const busyIntervals = (busy || []).map((a) => ({
    start: new Date(a.start_at).getTime() - BUFFER_MINUTES * 60000,
    end: new Date(a.end_at).getTime() + BUFFER_MINUTES * 60000,
  }));

  const availableDates = [];

  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (blockedSet.has(date)) continue;
    const windows = openByDate[date];
    if (!windows || !windows.length) continue;

    const dayStart = zonedTimeToUtc(date, 0, 0, TIMEZONE);
    if (dayStart > horizonEnd) continue;

    let hasSlot = false;
    for (const window of windows) {
      const { hour: openH, minute: openM } = parseTimeParts(window.start_time);
      const { hour: closeH, minute: closeM } = parseTimeParts(window.end_time);
      const openAt = zonedTimeToUtc(date, openH, openM, TIMEZONE);
      const closeAt = zonedTimeToUtc(date, closeH, closeM, TIMEZONE);

      for (let t = openAt.getTime(); t + duration * 60000 <= closeAt.getTime(); t += SLOT_STEP_MINUTES * 60000) {
        const slotStart = t;
        const slotEnd = t + duration * 60000;
        if (slotStart < earliestStart.getTime()) continue;
        const overlaps = busyIntervals.some((b) => slotStart < b.end && slotEnd > b.start);
        if (!overlaps) {
          hasSlot = true;
          break;
        }
      }
      if (hasSlot) break;
    }
    if (hasSlot) availableDates.push(date);
  }

  res.status(200).json({ availableDates });
};
