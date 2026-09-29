const { getSupabase } = require('../lib/supabase');

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const supabase = getSupabase();

  const [{ data, error }, { data: settings }] = await Promise.all([
    supabase
      .from('services')
      .select('id, name, duration_minutes, price_cents, deposit_cents, category, sort_order')
      .eq('active', true)
      .order('sort_order', { ascending: true }),
    supabase.from('business_settings').select('payment_policy').eq('id', true).maybeSingle(),
  ]);

  if (error) {
    res.status(500).json({ error: 'No se pudieron cargar los servicios' });
    return;
  }

  res.status(200).json({ services: data, paymentPolicy: settings?.payment_policy || 'client_choice' });
};
