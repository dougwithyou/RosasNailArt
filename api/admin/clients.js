const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

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
};
