const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');
const { getZonedDateParts, zonedTimeToUtc } = require('../../lib/timezone');
const { TIMEZONE } = require('../../lib/business-hours');

// Backs both the Inicio (stats) and Clientes tabs of the admin panel — merged
// into one function because the Vercel Hobby plan caps a deployment at 12
// Serverless Functions. Selected with ?view=stats|clients, the latter with an
// optional &email= for a single client's detail.

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

async function handleStats(req, res) {
  const now = new Date();
  const { year, month, day, weekday } = getZonedDateParts(now, TIMEZONE);
  const todayKey = dateKey(year, month, day);

  const mondayOffset = weekday === 0 ? -6 : 1 - weekday;
  const weekStartKey = addDaysToKey(todayKey, mondayOffset);
  const weekEndKey = addDaysToKey(weekStartKey, 7);
  const weekStart = zonedTimeToUtc(weekStartKey, 0, 0, TIMEZONE);
  const weekEnd = zonedTimeToUtc(weekEndKey, 0, 0, TIMEZONE);

  const monthStartKey = dateKey(year, month, 1);
  const nextMonthDate = new Date(Date.UTC(year, month, 1)); // month is 1-based, so this rolls to next month
  const nextMonthKey = dateKey(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, 1);
  const monthStart = zonedTimeToUtc(monthStartKey, 0, 0, TIMEZONE);
  const monthEnd = zonedTimeToUtc(nextMonthKey, 0, 0, TIMEZONE);

  const { data, error } = await getSupabase()
    .from('appointments')
    .select('id, client_name, client_email, service_label, start_at, deposit_cents')
    .eq('status', 'confirmed')
    .order('start_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'No se pudieron cargar las métricas' });
    return;
  }

  const appointments = data || [];
  const weekStartMs = weekStart.getTime();
  const weekEndMs = weekEnd.getTime();
  const monthStartMs = monthStart.getTime();
  const monthEndMs = monthEnd.getTime();
  const nowMs = now.getTime();

  let weekApptCount = 0;
  let weekDepositTotalCents = 0;
  let monthDepositTotalCents = 0;
  let nextAppointment = null;

  const visitsByEmail = new Map();

  appointments.forEach((a) => {
    const startMs = new Date(a.start_at).getTime();

    if (startMs >= weekStartMs && startMs < weekEndMs) {
      weekApptCount += 1;
      weekDepositTotalCents += a.deposit_cents || 0;
    }
    if (startMs >= monthStartMs && startMs < monthEndMs) {
      monthDepositTotalCents += a.deposit_cents || 0;
    }
    if (startMs >= nowMs && !nextAppointment) {
      nextAppointment = {
        clientName: a.client_name,
        serviceLabel: a.service_label,
        startAt: a.start_at,
      };
    }

    const key = a.client_email;
    if (key) {
      const entry = visitsByEmail.get(key) || { name: a.client_name, email: key, visits: 0 };
      entry.visits += 1;
      entry.name = a.client_name; // keep most recent name on file
      visitsByEmail.set(key, entry);
    }
  });

  const topClients = [...visitsByEmail.values()]
    .sort((a, b) => b.visits - a.visits)
    .slice(0, 5);

  res.status(200).json({
    weekApptCount,
    weekDepositTotalCents,
    monthDepositTotalCents,
    topClients,
    nextAppointment,
  });
}

function addDaysToKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

async function handleClients(req, res) {
  const supabase = getSupabase();
  const { email } = req.query;

  if (email) {
    const { data, error } = await supabase
      .from('appointments')
      .select('id, service_label, client_name, client_phone, client_email, notes, start_at, end_at, status, price_cents, deposit_cents')
      .eq('client_email', email)
      .in('status', ['confirmed', 'pending_payment'])
      .order('start_at', { ascending: true });

    if (error) {
      res.status(500).json({ error: 'No se pudo cargar la clienta' });
      return;
    }

    const appointments = data || [];
    const nowMs = Date.now();
    const upcoming = appointments.filter((a) => new Date(a.start_at).getTime() >= nowMs);
    const past = appointments
      .filter((a) => new Date(a.start_at).getTime() < nowMs)
      .sort((a, b) => new Date(b.start_at) - new Date(a.start_at));

    if (!appointments.length) {
      res.status(404).json({ error: 'Clienta no encontrada' });
      return;
    }

    const last = appointments[appointments.length - 1];
    res.status(200).json({
      client: {
        name: last.client_name,
        email: last.client_email,
        phone: last.client_phone,
      },
      upcoming,
      past,
    });
    return;
  }

  const { data, error } = await supabase
    .from('appointments')
    .select('client_name, client_email, client_phone, start_at, status')
    .in('status', ['confirmed', 'pending_payment'])
    .order('start_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'No se pudo cargar la lista de clientas' });
    return;
  }

  const nowMs = Date.now();
  const byEmail = new Map();

  (data || []).forEach((a) => {
    const key = a.client_email;
    if (!key) return;
    const entry = byEmail.get(key) || {
      name: a.client_name,
      email: key,
      phone: a.client_phone,
      visits: 0,
      lastVisit: null,
      nextVisit: null,
    };
    entry.name = a.client_name;
    entry.phone = a.client_phone;
    entry.visits += 1;

    const startMs = new Date(a.start_at).getTime();
    if (startMs < nowMs) {
      if (!entry.lastVisit || startMs > new Date(entry.lastVisit).getTime()) entry.lastVisit = a.start_at;
    } else {
      if (!entry.nextVisit || startMs < new Date(entry.nextVisit).getTime()) entry.nextVisit = a.start_at;
    }

    byEmail.set(key, entry);
  });

  const clients = [...byEmail.values()].sort((a, b) => a.name.localeCompare(b.name));
  res.status(200).json({ clients });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const { view } = req.query;
  if (view === 'clients') return handleClients(req, res);
  if (view === 'stats') return handleStats(req, res);

  res.status(400).json({ error: 'Falta el parámetro view' });
};
