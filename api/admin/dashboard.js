const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');
const { getZonedDateParts, zonedTimeToUtc } = require('../../lib/timezone');
const { TIMEZONE } = require('../../lib/business-hours');

// Backs both the Inicio (stats) and Clientes tabs of the admin panel — merged
// into one function because the Vercel Hobby plan caps a deployment at 12
// Serverless Functions. Selected with ?view=stats|clients, the latter with an
// optional &phone= for a single client's detail.

function dateKey(year, month, day) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function addDaysToKey(key, n) {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Same phone in different formats ("(571) 555-1234" vs "571-555-1234" vs
// "+15715551234") must resolve to the same client, so clients are grouped by
// digits only, with a leading US country code stripped.
function normalizePhone(phone) {
  let digits = (phone || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
  return digits;
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

  const tomorrowKey = addDaysToKey(todayKey, 1);
  const todayStart = zonedTimeToUtc(todayKey, 0, 0, TIMEZONE);
  const todayEnd = zonedTimeToUtc(tomorrowKey, 0, 0, TIMEZONE);

  const monthStartKey = dateKey(year, month, 1);
  const nextMonthDate = new Date(Date.UTC(year, month, 1)); // month is 1-based, so this rolls to next month
  const nextMonthKey = dateKey(nextMonthDate.getUTCFullYear(), nextMonthDate.getUTCMonth() + 1, 1);
  const monthStart = zonedTimeToUtc(monthStartKey, 0, 0, TIMEZONE);
  const monthEnd = zonedTimeToUtc(nextMonthKey, 0, 0, TIMEZONE);

  const { data, error } = await getSupabase()
    .from('appointments')
    .select('id, client_name, client_phone, service_label, start_at, status, deposit_cents')
    .in('status', ['confirmed', 'pending_payment'])
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
  const todayStartMs = todayStart.getTime();
  const todayEndMs = todayEnd.getTime();
  const nowMs = now.getTime();

  let weekApptCount = 0;
  let weekDepositTotalCents = 0;
  let monthDepositTotalCents = 0;
  let nextAppointment = null;
  const todayAppointments = [];

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
    if (startMs >= todayStartMs && startMs < todayEndMs) {
      todayAppointments.push({
        id: a.id,
        clientName: a.client_name,
        clientPhone: a.client_phone,
        phoneKey: normalizePhone(a.client_phone),
        serviceLabel: a.service_label,
        startAt: a.start_at,
        status: a.status,
      });
    }
  });

  res.status(200).json({
    weekApptCount,
    weekDepositTotalCents,
    monthDepositTotalCents,
    nextAppointment,
    todayAppointments,
  });
}

async function handleClients(req, res) {
  const supabase = getSupabase();
  const { phone } = req.query;

  if (phone) {
    const { data, error } = await supabase
      .from('appointments')
      .select('id, service_label, client_name, client_phone, client_email, notes, start_at, end_at, status, price_cents, deposit_cents')
      .in('status', ['confirmed', 'pending_payment', 'cancelled'])
      .order('start_at', { ascending: true });

    if (error) {
      res.status(500).json({ error: 'No se pudo cargar la clienta' });
      return;
    }

    const appointments = (data || []).filter((a) => normalizePhone(a.client_phone) === phone);
    if (!appointments.length) {
      res.status(404).json({ error: 'Clienta no encontrada' });
      return;
    }

    const nowMs = Date.now();
    const upcoming = appointments.filter((a) => a.status !== 'cancelled' && new Date(a.start_at).getTime() >= nowMs);
    const past = appointments
      .filter((a) => a.status === 'cancelled' || new Date(a.start_at).getTime() < nowMs)
      .sort((a, b) => new Date(b.start_at) - new Date(a.start_at));

    const emails = [...new Set(appointments.map((a) => a.client_email).filter(Boolean))];
    const last = appointments[appointments.length - 1];

    res.status(200).json({
      client: {
        name: last.client_name,
        phone: last.client_phone,
        email: last.client_email,
        emails,
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
  const byPhone = new Map();

  (data || []).forEach((a) => {
    const phoneKey = normalizePhone(a.client_phone);
    if (!phoneKey) return;
    const entry = byPhone.get(phoneKey) || {
      name: a.client_name,
      phone: a.client_phone,
      phoneKey,
      emails: new Set(),
      visits: 0,
      lastVisit: null,
      nextVisit: null,
    };
    entry.name = a.client_name;
    entry.phone = a.client_phone;
    if (a.client_email) entry.emails.add(a.client_email);
    entry.visits += 1;

    const startMs = new Date(a.start_at).getTime();
    if (startMs < nowMs) {
      if (!entry.lastVisit || startMs > new Date(entry.lastVisit).getTime()) entry.lastVisit = a.start_at;
    } else {
      if (!entry.nextVisit || startMs < new Date(entry.nextVisit).getTime()) entry.nextVisit = a.start_at;
    }

    byPhone.set(phoneKey, entry);
  });

  const clients = [...byPhone.values()]
    .map((c) => ({ ...c, emails: [...c.emails] }))
    .sort((a, b) => a.name.localeCompare(b.name));
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
