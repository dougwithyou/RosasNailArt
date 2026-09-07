const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');
const { sendAppointmentNotice } = require('../../lib/resend');

const VALID_TYPES = ['reschedule', 'late', 'custom'];

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const { appointmentId, clientEmail, clientName, type, customMessage } = req.body || {};
  if (!VALID_TYPES.includes(type)) {
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
    const { data: appointment, error } = await getSupabase()
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
};
