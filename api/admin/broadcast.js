const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');
const { sendBroadcast } = require('../../lib/resend');

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

module.exports = async function handler(req, res) {
  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    // Preview recipient count before sending.
    const { data, error } = await supabase
      .from('appointments')
      .select('client_email')
      .in('status', ['confirmed', 'pending_payment']);

    if (error) {
      res.status(500).json({ error: 'No se pudo calcular los destinatarios' });
      return;
    }
    const count = new Set((data || []).map((a) => a.client_email)).size;
    res.status(200).json({ recipientCount: count });
    return;
  }

  if (req.method === 'POST') {
    const { subject, message } = req.body || {};
    if (!subject?.trim() || !message?.trim()) {
      res.status(400).json({ error: 'Falta el asunto o el mensaje' });
      return;
    }

    const { data, error } = await supabase
      .from('appointments')
      .select('client_email, client_name, created_at')
      .in('status', ['confirmed', 'pending_payment'])
      .order('created_at', { ascending: false });

    if (error) {
      res.status(500).json({ error: 'No se pudo cargar la lista de clientas' });
      return;
    }

    const seen = new Map();
    (data || []).forEach((a) => {
      if (!seen.has(a.client_email)) seen.set(a.client_email, a.client_name);
    });
    const recipients = [...seen.entries()].map(([email, name]) => ({ email, name }));

    try {
      for (const batch of chunk(recipients, 100)) {
        await sendBroadcast(batch, { subject: subject.trim(), message: message.trim() });
      }
      res.status(200).json({ sent: true, recipientCount: recipients.length });
    } catch (err) {
      console.error('Failed to send broadcast', err);
      res.status(500).json({ error: 'No se pudo enviar el anuncio' });
    }
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
