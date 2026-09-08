const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');
const { sendBroadcast, sendAppointmentNotice } = require('../../lib/resend');

const NOTICE_TYPES = ['reschedule', 'late', 'custom'];

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// Sends a one-off notice to a single client — either about a specific
// appointment (appointmentId) or directly to a client's contact info (from
// her ficha in Clientes). Merged into this file (alongside the all-clients
// broadcast below) to stay within Vercel's 12 Serverless Functions cap.
async function handleNotify(req, res, supabase) {
  const { appointmentId, clientEmail, clientName, type, customMessage } = req.body || {};
  if (!NOTICE_TYPES.includes(type)) {
    res.status(400).json({ error: 'Datos inválidos' });
    return;
  }
  if (!appointmentId && !(clientEmail && clientName)) {
    res.status(400).json({ error: 'Datos inválidos' });
    return;
  }
  if (!appointmentId && type !== 'custom') {
    res.status(400).json({ error: 'Datos inválidos' });
    return;
  }
  if (type === 'custom' && !customMessage?.trim()) {
    res.status(400).json({ error: 'Escribe un mensaje' });
    return;
  }

  let recipient = { email: clientEmail, name: clientName, startAt: null };

  if (appointmentId) {
    const { data: appointment, error } = await supabase
      .from('appointments')
      .select('client_email, client_name, start_at')
      .eq('id', appointmentId)
      .single();

    if (error || !appointment) {
      res.status(404).json({ error: 'Cita no encontrada' });
      return;
    }
    recipient = { email: appointment.client_email, name: appointment.client_name, startAt: appointment.start_at };
  }

  try {
    await sendAppointmentNotice({
      to: recipient.email,
      clientName: recipient.name,
      startAt: recipient.startAt,
      type,
      customMessage,
    });
    res.status(200).json({ sent: true });
  } catch (err) {
    console.error('Failed to send appointment notice for', appointmentId || recipient.email, err);
    res.status(500).json({ error: 'No se pudo enviar el mensaje' });
  }
}

module.exports = async function handler(req, res) {
  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const supabase = getSupabase();

  if (req.method === 'POST' && req.body?.mode === 'notify') {
    return handleNotify(req, res, supabase);
  }

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
