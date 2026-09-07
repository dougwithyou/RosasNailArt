const { getSupabase } = require('../../../lib/supabase');
const { requireRole } = require('../../../lib/auth');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const MAX_BULK_RANGE_DAYS = 90;

function addDays(dateStr, n) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function createSingle(req, res, supabase) {
  const { date, startTime, endTime } = req.body || {};
  if (!DATE_RE.test(date || '') || !TIME_RE.test(startTime || '') || !TIME_RE.test(endTime || '') || startTime >= endTime) {
    res.status(400).json({ error: 'Datos inválidos' });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (date < today) {
    res.status(400).json({ error: 'No puedes abrir un día que ya pasó' });
    return;
  }

  const { data, error } = await supabase
    .from('open_slots')
    .insert({ date, start_time: startTime, end_time: endTime })
    .select()
    .single();

  if (error) {
    res.status(500).json({ error: 'No se pudo abrir el horario' });
    return;
  }
  res.status(201).json({ openSlot: data });
}

// Opens the same start/end window across every date in [fromDate, toDate]
// whose weekday is in daysOfWeek (0=Domingo..6=Sábado), so Maribel can open
// e.g. "martes a viernes, 9:30-6:30" for the next few weeks in one submit
// instead of one row at a time.
async function createBulk(req, res, supabase) {
  const { fromDate, toDate, daysOfWeek, startTime, endTime } = req.body || {};

  const days = Array.isArray(daysOfWeek) ? daysOfWeek.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6) : [];

  if (
    !DATE_RE.test(fromDate || '') ||
    !DATE_RE.test(toDate || '') ||
    fromDate > toDate ||
    !days.length ||
    !TIME_RE.test(startTime || '') ||
    !TIME_RE.test(endTime || '') ||
    startTime >= endTime
  ) {
    res.status(400).json({ error: 'Datos inválidos' });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  if (fromDate < today) {
    res.status(400).json({ error: 'No puedes abrir un día que ya pasó' });
    return;
  }

  const dayCount = (new Date(`${toDate}T00:00:00Z`) - new Date(`${fromDate}T00:00:00Z`)) / 86400000 + 1;
  if (dayCount > MAX_BULK_RANGE_DAYS) {
    res.status(400).json({ error: 'Rango demasiado grande' });
    return;
  }

  const daySet = new Set(days);
  const candidateDates = [];
  for (let date = fromDate; date <= toDate; date = addDays(date, 1)) {
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    if (daySet.has(weekday)) candidateDates.push(date);
  }

  if (!candidateDates.length) {
    res.status(200).json({ created: 0, skipped: 0 });
    return;
  }

  const { data: existing, error: existingError } = await supabase
    .from('open_slots')
    .select('date, start_time, end_time')
    .gte('date', fromDate)
    .lte('date', toDate);

  if (existingError) {
    res.status(500).json({ error: 'No se pudieron abrir los horarios' });
    return;
  }

  const existingKeys = new Set((existing || []).map((s) => `${s.date}|${s.start_time.slice(0, 5)}|${s.end_time.slice(0, 5)}`));
  const rows = candidateDates
    .filter((date) => !existingKeys.has(`${date}|${startTime}|${endTime}`))
    .map((date) => ({ date, start_time: startTime, end_time: endTime }));

  if (!rows.length) {
    res.status(200).json({ created: 0, skipped: candidateDates.length });
    return;
  }

  const { error } = await supabase.from('open_slots').insert(rows);
  if (error) {
    res.status(500).json({ error: 'No se pudieron abrir los horarios' });
    return;
  }

  res.status(201).json({ created: rows.length, skipped: candidateDates.length - rows.length });
}

module.exports = async function handler(req, res) {
  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { from, to } = req.query;
    let query = supabase.from('open_slots').select('id, date, start_time, end_time').order('date', { ascending: true });
    if (from) query = query.gte('date', from);
    if (to) query = query.lte('date', to);

    const { data, error } = await query;
    if (error) {
      res.status(500).json({ error: 'No se pudo cargar los horarios abiertos' });
      return;
    }
    res.status(200).json({ openSlots: data });
    return;
  }

  if (req.method === 'POST') {
    if (req.body && req.body.fromDate) return createBulk(req, res, supabase);
    return createSingle(req, res, supabase);
  }

  res.status(405).json({ error: 'Method not allowed' });
};
