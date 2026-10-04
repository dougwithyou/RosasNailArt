const Stripe = require('stripe');
const { getSupabase } = require('../../lib/supabase');
const { requireRole } = require('../../lib/auth');
const { sendCancellationEmail } = require('../../lib/resend');
const { BUFFER_MINUTES, PENDING_HOLD_MINUTES } = require('../../lib/business-hours');

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

// The itemized payment history for one appointment (online charge + any
// manual cash/card entries Maribel logged), so she can see exactly what
// makes up the running total against the service price.
async function handlePaymentsFor(req, res, supabase) {
  const { paymentsFor } = req.query;
  const { data, error } = await supabase
    .from('appointment_payments')
    .select('id, amount_cents, method, note, created_at')
    .eq('appointment_id', paymentsFor)
    .order('created_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'No se pudieron cargar los pagos' });
    return;
  }

  res.status(200).json({ payments: data });
}

async function handleList(req, res, supabase) {
  const { from, to } = req.query;
  if (!from || !to) {
    res.status(400).json({ error: 'Faltan parámetros from/to' });
    return;
  }

  const { data, error } = await supabase
    .from('appointments')
    .select('id, service_label, client_name, client_phone, client_email, notes, start_at, end_at, status, price_cents, deposit_cents, payment_type')
    .in('status', ['confirmed', 'pending_payment', 'cancelled'])
    .gte('start_at', from)
    .lte('start_at', to)
    .order('start_at', { ascending: true });

  if (error) {
    res.status(500).json({ error: 'No se pudo cargar la agenda' });
    return;
  }

  const appointments = data || [];
  const ids = appointments.map((a) => a.id);
  const amountPaidById = new Map();
  if (ids.length) {
    const { data: payments } = await supabase.from('appointment_payments').select('appointment_id, amount_cents').in('appointment_id', ids);
    (payments || []).forEach((p) => {
      amountPaidById.set(p.appointment_id, (amountPaidById.get(p.appointment_id) || 0) + p.amount_cents);
    });
  }

  res.status(200).json({
    appointments: appointments.map((a) => ({ ...a, amountPaidCents: amountPaidById.get(a.id) || 0 })),
  });
}

// Lets Maribel block a slot for a client she booked directly (e.g. via
// WhatsApp) without going through Stripe checkout — status is 'confirmed'
// immediately with no deposit charged online.
async function handleManualCreate(req, res, supabase) {
  const { serviceId, clientName, clientPhone, clientEmail, startAt, notes } = req.body || {};

  if (!serviceId || !clientName?.trim() || !clientPhone?.trim() || !startAt) {
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
      client_email: clientEmail?.trim() || null,
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

// Permanently removes an appointment row — for wiping test/junk bookings
// so they stop counting toward the Inicio revenue stats. Unlike "cancel",
// this does not touch Stripe (no refund), so it should only be used on
// appointments that never had a real charge.
async function handleDelete(req, res, supabase) {
  const { id } = req.body || {};
  if (!id) {
    res.status(400).json({ error: 'Falta el id de la cita' });
    return;
  }

  const { error } = await supabase.from('appointments').delete().eq('id', id);
  if (error) {
    res.status(500).json({ error: 'No se pudo borrar la cita' });
    return;
  }

  res.status(200).json({ deleted: true });
}

// Lets Maribel log a payment she collected herself outside Stripe (cash or
// card in person — e.g. the remaining balance after an online deposit, or
// the whole thing for a walk-in), so her running total for the appointment
// reflects reality.
async function handleAddPayment(req, res, supabase) {
  const { id, amountCents, method, note } = req.body || {};
  const allowedMethods = ['cash', 'card', 'other'];
  if (!id || !Number.isFinite(amountCents) || amountCents <= 0 || !allowedMethods.includes(method)) {
    res.status(400).json({ error: 'Datos de pago inválidos' });
    return;
  }

  const { data: appointment } = await supabase.from('appointments').select('id').eq('id', id).single();
  if (!appointment) {
    res.status(404).json({ error: 'Cita no encontrada' });
    return;
  }

  const { error: insertError } = await supabase.from('appointment_payments').insert({
    appointment_id: id,
    amount_cents: Math.round(amountCents),
    method,
    note: note?.trim() || null,
  });

  if (insertError) {
    res.status(500).json({ error: 'No se pudo registrar el pago' });
    return;
  }

  const { data: payments } = await supabase.from('appointment_payments').select('amount_cents').eq('appointment_id', id);
  const amountPaidCents = (payments || []).reduce((sum, p) => sum + p.amount_cents, 0);

  res.status(200).json({ recorded: true, amountPaidCents });
}

module.exports = async function handler(req, res) {
  const user = await requireRole(req, res, ['owner', 'superadmin']);
  if (!user) return;

  const supabase = getSupabase();

  if (req.method === 'GET') {
    if (req.query.paymentsFor) return handlePaymentsFor(req, res, supabase);
    return handleList(req, res, supabase);
  }
  if (req.method === 'POST') return handleManualCreate(req, res, supabase);
  if (req.method === 'DELETE') return handleDelete(req, res, supabase);
  if (req.method === 'PATCH') {
    const { action } = req.body || {};
    if (action === 'cancel') return handleCancel(req, res, supabase);
    if (action === 'add-payment') return handleAddPayment(req, res, supabase);
    res.status(400).json({ error: 'Acción inválida' });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
