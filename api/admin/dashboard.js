const Stripe = require('stripe');
const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');
const { getZonedDateParts, zonedTimeToUtc } = require('../../lib/timezone');
const { TIMEZONE } = require('../../lib/business-hours');

// Backs the Inicio (stats + Stripe balance) and Clientes tabs of the admin
// panel, plus the Stripe Connect OAuth callback — merged into one function
// because the Vercel Hobby plan caps a deployment at 12 Serverless
// Functions. Selected with ?view=stats|clients|stripe-balance|stripe-connect-callback,
// clients with an optional &phone= for a single client's detail.

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

// Public OAuth client ID (safe to ship to the browser — mirrors the same
// constant in js/admin.js), needed here to deauthorize the connected
// account on Stripe's side when Maribel disconnects.
const STRIPE_CONNECT_CLIENT_ID = 'ca_V6YOBs1PnrEnbraOEDn71w1lZHXQejk4';

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

// Permanently removes a client and every appointment of hers — for wiping
// test clients so they stop appearing in the Clientes list and stop
// counting toward the Inicio revenue stats. Does not touch Stripe; only
// meant for bookings that never had a real charge.
async function handleClientDelete(req, res) {
  const { phone } = req.query;
  if (!phone) {
    res.status(400).json({ error: 'Falta el teléfono de la clienta' });
    return;
  }

  const supabase = getSupabase();
  const { data, error } = await supabase.from('appointments').select('id, client_phone');
  if (error) {
    res.status(500).json({ error: 'No se pudo cargar las citas de la clienta' });
    return;
  }

  const ids = (data || []).filter((a) => normalizePhone(a.client_phone) === phone).map((a) => a.id);
  if (!ids.length) {
    res.status(404).json({ error: 'Clienta no encontrada' });
    return;
  }

  const { error: delError } = await supabase.from('appointments').delete().in('id', ids);
  if (delError) {
    res.status(500).json({ error: 'No se pudo borrar a la clienta' });
    return;
  }

  res.status(200).json({ deleted: true, count: ids.length });
}

const PAYMENT_POLICIES = ['deposit_only', 'full_only', 'client_choice'];

async function handleGetPaymentPolicy(req, res) {
  const { data, error } = await getSupabase().from('business_settings').select('payment_policy').eq('id', true).maybeSingle();
  if (error) {
    res.status(500).json({ error: 'No se pudo cargar la política de pago' });
    return;
  }
  res.status(200).json({ paymentPolicy: data?.payment_policy || 'client_choice' });
}

async function handleSetPaymentPolicy(req, res) {
  const { paymentPolicy } = req.body || {};
  if (!PAYMENT_POLICIES.includes(paymentPolicy)) {
    res.status(400).json({ error: 'Política de pago inválida' });
    return;
  }
  const { error } = await getSupabase().from('business_settings').update({ payment_policy: paymentPolicy }).eq('id', true);
  if (error) {
    res.status(500).json({ error: 'No se pudo guardar la política de pago' });
    return;
  }
  res.status(200).json({ paymentPolicy });
}

async function handleStripeBalance(req, res) {
  const { data: settings, error } = await getSupabase()
    .from('business_settings')
    .select('stripe_account_id, stripe_connected_at')
    .eq('id', true)
    .single();

  if (error) {
    res.status(500).json({ error: 'No se pudo verificar la conexión con Stripe' });
    return;
  }

  if (!settings?.stripe_account_id) {
    res.status(200).json({ connected: false });
    return;
  }

  try {
    const balance = await getStripe().balance.retrieve({ stripeAccount: settings.stripe_account_id });
    const sum = (arr) => arr.reduce((acc, b) => acc + b.amount, 0);
    res.status(200).json({
      connected: true,
      connectedAt: settings.stripe_connected_at,
      availableCents: sum(balance.available),
      pendingCents: sum(balance.pending),
    });
  } catch (err) {
    // A saved account id that no longer exists on the key currently in use
    // (e.g. a test-mode connection left over from before switching the
    // platform to live mode) isn't a transient failure — Stripe will never
    // recognize it again, and leaving it in place would permanently break
    // this card. Clear it so Maribel sees "Conectar con Stripe" instead of
    // a dead end with no way to reconnect.
    const isStaleAccount = err.code === 'resource_missing' || /No such connected account/i.test(err.message || '');
    if (isStaleAccount) {
      await getSupabase()
        .from('business_settings')
        .update({ stripe_account_id: null, stripe_connected_at: null })
        .eq('id', true);
      res.status(200).json({ connected: false });
      return;
    }
    console.error('Failed to retrieve Stripe balance', err);
    res.status(500).json({ error: 'No se pudo consultar el balance de Stripe' });
  }
}

// Lets Maribel disconnect her current Stripe account (e.g. to connect a
// different one). Revokes our platform's access on Stripe's side, then
// clears the stored account id so booking.html's checkout falls back to
// the platform's own test account until she connects a new one.
async function handleStripeDisconnect(req, res) {
  const { data: settings, error } = await getSupabase()
    .from('business_settings')
    .select('stripe_account_id')
    .eq('id', true)
    .single();

  if (error) {
    res.status(500).json({ error: 'No se pudo verificar la conexión con Stripe' });
    return;
  }

  if (!settings?.stripe_account_id) {
    res.status(200).json({ connected: false });
    return;
  }

  try {
    await getStripe().oauth.deauthorize({
      client_id: STRIPE_CONNECT_CLIENT_ID,
      stripe_user_id: settings.stripe_account_id,
    });
  } catch (err) {
    // Keep going even if Stripe's side is already disconnected (e.g. she
    // revoked access from her own Stripe dashboard first) — our own
    // record still needs clearing either way.
    console.error('Stripe OAuth deauthorize failed', err);
  }

  const { error: dbError } = await getSupabase()
    .from('business_settings')
    .update({ stripe_account_id: null, stripe_connected_at: null })
    .eq('id', true);

  if (dbError) {
    res.status(500).json({ error: 'No se pudo desconectar la cuenta de Stripe' });
    return;
  }

  res.status(200).json({ connected: false });
}

// Stripe redirects the browser here after Maribel approves the OAuth
// connection — a plain unauthenticated GET, not one of our normal
// Bearer-token AJAX calls. The "state" param carries her Supabase access
// token (set by the frontend before redirecting to Stripe) so this can
// still be verified as coming from an authenticated owner.
async function handleStripeConnectCallback(req, res) {
  const { code, state, error } = req.query;

  if (error) {
    res.redirect(302, '/admin.html?stripe_connect=error');
    return;
  }

  req.headers.authorization = `Bearer ${state || ''}`;
  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  try {
    const tokenResponse = await getStripe().oauth.token({ grant_type: 'authorization_code', code });

    const { error: dbError } = await getSupabase()
      .from('business_settings')
      .update({ stripe_account_id: tokenResponse.stripe_user_id, stripe_connected_at: new Date().toISOString() })
      .eq('id', true);

    if (dbError) throw dbError;

    res.redirect(302, '/admin.html?stripe_connect=success');
  } catch (err) {
    console.error('Stripe Connect OAuth exchange failed', err);
    res.redirect(302, '/admin.html?stripe_connect=error');
  }
}

module.exports = async function handler(req, res) {
  const { view } = req.query;

  // Handles its own auth (via the state param) since it's a browser
  // redirect from Stripe, not an authenticated AJAX call.
  if (view === 'stripe-connect-callback') {
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    return handleStripeConnectCallback(req, res);
  }

  if (view === 'stripe-disconnect') {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const user = await requireRole(req, res, ['owner', 'superadmin']);
    if (!user) return;
    return handleStripeDisconnect(req, res);
  }

  if (view === 'client-delete') {
    if (req.method !== 'DELETE') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }
    const user = await requireRole(req, res, ['owner', 'superadmin']);
    if (!user) return;
    return handleClientDelete(req, res);
  }

  if (view === 'payment-policy' && req.method === 'POST') {
    const user = await requireRole(req, res, ['owner', 'superadmin']);
    if (!user) return;
    return handleSetPaymentPolicy(req, res);
  }

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  if (view === 'clients') return handleClients(req, res);
  if (view === 'stats') return handleStats(req, res);
  if (view === 'stripe-balance') return handleStripeBalance(req, res);
  if (view === 'payment-policy') return handleGetPaymentPolicy(req, res);

  res.status(400).json({ error: 'Falta el parámetro view' });
};
