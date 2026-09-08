const Stripe = require('stripe');
const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');
const { sendCancellationEmail } = require('../../lib/resend');
const { BUFFER_MINUTES, PENDING_HOLD_MINUTES } = require('../../lib/business-hours');

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

async function handleList(req, res, supabase) {
  const { from, to } = req.query;
  if (!from || !to) {
    res.status(400).json({ error: 'Faltan parámetros from/to' });
    return;
  }

  const { data, error } = await supabase
    .from('appointments')
    .select('id, service_label, client_name, client_phone, client_email, notes, start_at, end_at, status, price_cents, deposit_cents')
    .in('status', ['confirmed', 'pending_payment', 'cancelled'])
    .gte('start_at', from)
    .lte('start_at', to)
    .order('start_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'No se pudo cargar la agenda' });
    return;
  }

  res.status(200).json({ appointments: data });
}

// Lets Maribel block a slot for a client she booked directly (e.g. via
// WhatsApp) without going through Stripe checkout — status is 'confirmed'
// immediately with no deposit charged online.
async function handleManualCreate(req, res, supabase) {
  const { serviceId, clientName, clientPhone, clientEmail, startAt, notes } = req.body || {};

  if (!serviceId || !clientName?.trim() || !clientPhone?.trim() || !clientEmail?.trim() || !startAt) {
    res.status(400).json({ error: 'Faltan datos requeridos' });
    return;
  }

  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    res.status(400).json({ error: 'Fecha inválida' });
    return;
  }

  const { data: service, error: serviceError } = await supabase
    .from('services')
    .select('id, name, duration_minutes, price_cents')
    .eq('id', serviceId)
    .single();

  if (serviceError || !service) {
    res.status(400).json({ error: 'Servicio no válido' });
    return;
  }

  const end = new Date(start.getTime() + service.duration_minutes * 60000);

  const pendingCutoff = new Date(Date.now() - PENDING_HOLD_MINUTES * 60000).toISOString();
  const { data: busy, error: busyError } = await supabase
    .from('appointments')
    .select('id')
    .lt('start_at', new Date(end.getTime() + BUFFER_MINUTES * 60000).toISOString())
    .gt('end_at', new Date(start.getTime() - BUFFER_MINUTES * 60000).toISOString())
    .or(`status.eq.confirmed,and(status.eq.pending_payment,created_at.gte.${pendingCutoff})`);

  if (busyError) {
    res.status(500).json({ error: 'No se pudo verificar disponibilidad' });
    return;
  }
  if (busy && busy.length > 0) {
    res.status(409).json({ error: 'Ese horario ya está ocupado por otra cita' });
    return;
  }

  const { data: appointment, error: insertError } = await supabase
    .from('appointments')
    .insert({
      service_id: serviceId,
      client_name: clientName.trim(),
      client_phone: clientPhone.trim(),
      client_email: clientEmail.trim(),
      notes: notes?.trim() || null,
      start_at: start.toISOString(),
      end_at: end.toISOString(),
      status: 'confirmed',
      deposit_cents: 0,
      price_cents: service.price_cents,
      service_label: service.name,
    })
    .select()
    .single();

  if (insertError || !appointment) {
    res.status(500).json({ error: 'No se pudo crear la cita' });
    return;
  }

  res.status(201).json({ appointment });
}

// Cancels an appointment, refunds the deposit via Stripe when one was
// actually charged (status was 'confirmed'), and emails the client with a
// link to reschedule.
async function handleCancel(req, res, supabase) {
  const { id } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'Falta el id de la cita' });
    return;
  }

  const { data: appointment, error } = await supabase.from('appointments').select('*').eq('id', id).single();
  if (error || !appointment) {
    res.status(404).json({ error: 'Cita no encontrada' });
    return;
  }
  if (appointment.status === 'cancelled') {
    res.status(400).json({ error: 'Esa cita ya está cancelada' });
    return;
  }

  let refunded = false;
  if (appointment.status === 'confirmed' && appointment.stripe_session_id) {
    try {
      const stripe = getStripe();
      // The charge may have run on Maribel's connected Stripe account
      // (recorded on the appointment at booking time) rather than the
      // platform account, so both lookups must target the same one.
      const stripeOpts = appointment.stripe_account_id ? { stripeAccount: appointment.stripe_account_id } : undefined;
      const session = await stripe.checkout.sessions.retrieve(appointment.stripe_session_id, stripeOpts);
      if (session.payment_intent) {
        await stripe.refunds.create({ payment_intent: session.payment_intent }, stripeOpts);
        refunded = true;
      }
    } catch (err) {
      console.error('Failed to refund appointment', id, err);
      res.status(500).json({ error: 'No se pudo procesar el reembolso. Intenta de nuevo.' });
      return;
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('appointments')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select()
    .single();

  if (updateError || !updated) {
    res.status(500).json({ error: 'No se pudo cancelar la cita' });
    return;
  }

  try {
    const origin = req.headers.origin || `https://${req.headers.host}`;
    await sendCancellationEmail({
      to: appointment.client_email,
      clientName: appointment.client_name,
      serviceName: appointment.service_label,
      startAt: appointment.start_at,
      rescheduleUrl: `${origin}/booking.html`,
      refunded,
    });
  } catch (emailErr) {
    console.error('Failed to send cancellation email for', id, emailErr);
  }

  res.status(200).json({ cancelled: true, refunded, appointment: updated });
}

module.exports = async function handler(req, res) {
  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const supabase = getSupabase();

  if (req.method === 'GET') return handleList(req, res, supabase);
  if (req.method === 'POST') return handleManualCreate(req, res, supabase);
  if (req.method === 'PATCH') {
    const { action } = req.body || {};
    if (action === 'cancel') return handleCancel(req, res, supabase);
    res.status(400).json({ error: 'Acción inválida' });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
