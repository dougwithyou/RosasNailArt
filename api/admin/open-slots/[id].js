const { getSupabase } = require('../../../lib/supabase');
const { requireRole } = require('../../../lib/auth');

module.exports = async function handler(req, res) {
  if (req.method !== 'DELETE') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const { id } = req.query;
  const { error } = await getSupabase().from('open_slots').delete().eq('id', id);

  if (error) {
    res.status(500).json({ error: 'No se pudo quitar el horario' });
    return;
  }

  res.status(204).end();
};
