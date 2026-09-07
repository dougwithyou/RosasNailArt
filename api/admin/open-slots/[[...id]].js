const { getSupabase } = require('../../../lib/supabase');
const { requireRole } = require('../../../lib/auth');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

// Handles both /api/admin/open-slots (list/create) and
// /api/admin/open-slots/:id (delete) in one function — the Vercel Hobby
// plan caps a deployment at 12 Serverless Functions, so routes that share
// a resource are consolidated with an optional catch-all instead of one
// file per route.
module.exports = async function handler(req, res) {
  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const supabase = getSupabase();
  const [id] = req.query.id || [];

  if (id) {
    if (req.method !== 'DELETE') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    const { error } = await supabase.from('open_slots').delete().eq('id', id);
    if (error) {
      res.status(500).json({ error: 'No se pudo quitar el horario' });
      return;
    }
    res.status(204).end();
    return;
  }

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
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
