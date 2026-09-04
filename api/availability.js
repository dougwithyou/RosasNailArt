const { getSupabase } = require('../lib/supabase');
const { zonedTimeToUtc, getZonedDateParts } = require('../lib/timezone');
const {
  TIMEZONE,
  WORK_DAYS,
  OPEN_HOUR,
  OPEN_MINUTE,
  CLOSE_HOUR,
  CLOSE_MINUTE,
  BUFFER_MINUTES,
  MIN_NOTICE_MINUTES,
  BOOKING_HORIZON_DAYS,
  PENDING_HOLD_MINUTES,
  SLOT_STEP_MINUTES,
} = require('../lib/business-hours');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

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

  const { weekday } = getZonedDateParts(dayStart, TIMEZONE);
  if (!WORK_DAYS.includes(weekday)) {
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

  const openAt = zonedTimeToUtc(date, OPEN_HOUR, OPEN_MINUTE, TIMEZONE);
  const closeAt = zonedTimeToUtc(date, CLOSE_HOUR, CLOSE_MINUTE, TIMEZONE);

  const pendingCutoff = new Date(now.getTime() - PENDING_HOLD_MINUTES * 60000).toISOString();

  const { data: busy, error: busyError } = await supabase
    .from('appointments')
    .select('start_at, end_at, status, created_at')
    .lt('start_at', closeAt.toISOString())
    .gt('end_at', openAt.toISOString())
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
  const slots = [];

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

    slots.push(new Date(slotStart).toISOString());
  }

  res.status(200).json({ slots });
};
