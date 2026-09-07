const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { data, error } = await getSupabase()
    .from('services')
    .select('id, name, duration_minutes, price_cents, deposit_cents, category, sort_order')
    .eq('active', true)
    .order('sort_order', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'No se pudieron cargar los servicios' });
    return;
  }

  res.status(200).json({ services: data });
};
