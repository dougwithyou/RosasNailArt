const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');
const { DEPOSIT_CENTS } = require('../../lib/business-hours');

function validServicePayload(body) {
  const { name, durationMinutes, priceCents, category } = body || {};
  if (!name?.trim()) return false;
  if (!Number.isInteger(durationMinutes) || durationMinutes <= 0) return false;
  if (!Number.isInteger(priceCents) || priceCents < 0) return false;
  if (category && !['service', 'addon'].includes(category)) return false;
  return true;
}

module.exports = async function handler(req, res) {
  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('services')
      .select('id, name, duration_minutes, price_cents, deposit_cents, category, active, sort_order')
      .order('sort_order', { ascending: true });

    if (error) {
      res.status(500).json({ error: 'No se pudieron cargar los servicios' });
      return;
    }
    res.status(200).json({ services: data });
    return;
  }

  if (req.method === 'POST') {
    if (!validServicePayload(req.body)) {
      res.status(400).json({ error: 'Datos inválidos' });
      return;
    }
    const { name, durationMinutes, priceCents, category, sortOrder } = req.body;

    const { data, error } = await supabase
      .from('services')
      .insert({
        name: name.trim(),
        duration_minutes: durationMinutes,
        price_cents: priceCents,
        deposit_cents: DEPOSIT_CENTS,
        category: category || 'service',
        sort_order: Number.isInteger(sortOrder) ? sortOrder : 0,
      })
      .select()
      .single();

    if (error) {
      res.status(500).json({ error: 'No se pudo crear el servicio' });
      return;
    }
    res.status(201).json({ service: data });
    return;
  }

  if (req.method === 'PUT') {
    const { id, name, durationMinutes, priceCents, category, active, sortOrder } = req.body || {};
    if (!id) {
      res.status(400).json({ error: 'Falta el id del servicio' });
      return;
    }

    const update = {};
    if (name !== undefined) update.name = name.trim();
    if (durationMinutes !== undefined) update.duration_minutes = durationMinutes;
    if (priceCents !== undefined) update.price_cents = priceCents;
    if (category !== undefined) update.category = category;
    if (active !== undefined) update.active = active;
    if (sortOrder !== undefined) update.sort_order = sortOrder;

    const { data, error } = await supabase.from('services').update(update).eq('id', id).select().single();

    if (error) {
      res.status(500).json({ error: 'No se pudo actualizar el servicio' });
      return;
    }
    res.status(200).json({ service: data });
    return;
  }

  if (req.method === 'DELETE') {
    const { id } = req.body || {};
    if (!id) {
      res.status(400).json({ error: 'Falta el id del servicio' });
      return;
    }

    const { error: deleteError } = await supabase.from('services').delete().eq('id', id);

    if (!deleteError) {
      res.status(200).json({ deleted: true });
      return;
    }

    // Foreign key violation — this service has appointment history, so a
    // hard delete would break those records. Deactivate it instead.
    if (deleteError.code === '23503') {
      const { data, error: updateError } = await supabase.from('services').update({ active: false }).eq('id', id).select().single();
      if (updateError) {
        res.status(500).json({ error: 'No se pudo borrar ni desactivar el servicio' });
        return;
      }
      res.status(200).json({ deleted: false, deactivated: true, service: data });
      return;
    }

    res.status(500).json({ error: 'No se pudo borrar el servicio' });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
