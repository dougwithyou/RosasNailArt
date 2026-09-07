const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const { from, to } = req.query;
  if (!from || !to) {
    res.status(400).json({ error: 'Faltan parámetros from/to' });
    return;
  }

  const { data, error } = await getSupabase()
    .from('appointments')
    .select('id, service_label, client_name, client_phone, client_email, notes, start_at, end_at, status, price_cents, deposit_cents')
    .in('status', ['confirmed', 'pending_payment'])
    .gte('start_at', from)
    .lte('start_at', to)
    .order('start_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'No se pudo cargar la agenda' });
    return;
  }

  res.status(200).json({ appointments: data });
};
