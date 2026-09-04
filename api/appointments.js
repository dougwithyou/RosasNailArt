const Stripe = require('stripe');
const { getSupabase } = require('../lib/supabase');
const { TIMEZONE, BUFFER_MINUTES, MIN_NOTICE_MINUTES, BOOKING_HORIZON_DAYS, PENDING_HOLD_MINUTES } = require('../lib/business-hours');
const { zonedTimeToUtc } = require('../lib/timezone');

function parseTimeParts(timeStr) {
  const [hour, minute] = timeStr.split(':').map((n) => parseInt(n, 10));
  return { hour, minute };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function getStripe() {
  return new Stripe(process.env.STRIPE_SECRET_KEY);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const { serviceId, addonIds, startAt, clientName, clientPhone, clientEmail, notes } = req.body || {};

  if (
    !serviceId ||
    !startAt ||
    !clientName?.trim() ||
    !clientPhone?.trim() ||
    !clientEmail?.trim() ||
    !EMAIL_RE.test(clientEmail)
  ) {
    res.status(400).json({ error: 'Faltan datos requeridos o el email no es válido' });
    return;
  }

  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) {
    res.status(400).json({ error: 'Fecha inválida' });
    return;
  }

  const supabase = getSupabase();

  const allIds = [serviceId, ...(Array.isArray(addonIds) ? addonIds : [])];
  const { data: services, error: servicesError } = await supabase
    .from('services')
    .select('id, name, duration_minutes, price_cents, deposit_cents, active')
    .in('id', allIds);

  if (servicesError || !services || services.length !== allIds.length || services.some((s) => !s.active)) {
    res.status(400).json({ error: 'Servicio no válido' });
    return;
  }

  const totalDuration = services.reduce((sum, s) => sum + s.duration_minutes, 0);
  const totalPrice = services.reduce((sum, s) => sum + s.price_cents, 0);
  const totalDeposit = services.reduce((sum, s) => sum + s.deposit_cents, 0);
  const serviceLabel = services.map((s) => s.name).join(' + ');

  const end = new Date(start.getTime() + totalDuration * 60000);

  // Re-validate notice / horizon, and that the slot falls inside a window Maribel opened.
  const now = new Date();
  const dateStr = start.toISOString().slice(0, 10);
  const horizonEnd = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60000);
  const earliestStart = new Date(now.getTime() + MIN_NOTICE_MINUTES * 60000);

  if (start > horizonEnd || start < earliestStart) {
    res.status(409).json({ error: 'Ese horario ya no está disponible. Por favor elige otro.' });
    return;
  }

  const { data: blocked } = await supabase.from('blocked_dates').select('date').eq('date', dateStr).maybeSingle();
  const { data: openSlots, error: openSlotsError } = await supabase
    .from('open_slots')
    .select('start_time, end_time')
    .eq('date', dateStr);

  if (openSlotsError) {
    res.status(500).json({ error: 'No se pudo verificar disponibilidad' });
    return;
  }

  const fitsInOpenWindow = !blocked && (openSlots || []).some((w) => {
    const { hour: openH, minute: openM } = parseTimeParts(w.start_time);
    const { hour: closeH, minute: closeM } = parseTimeParts(w.end_time);
    const openAt = zonedTimeToUtc(dateStr, openH, openM, TIMEZONE);
    const closeAt = zonedTimeToUtc(dateStr, closeH, closeM, TIMEZONE);
    return start >= openAt && end <= closeAt;
  });

  if (!fitsInOpenWindow) {
    res.status(409).json({ error: 'Ese horario ya no está disponible. Por favor elige otro.' });
    return;
  }

  // Re-check overlap against confirmed / still-held pending appointments.
  const pendingCutoff = new Date(now.getTime() - PENDING_HOLD_MINUTES * 60000).toISOString();
  const { data: busy, error: busyError } = await supabase
    .from('appointments')
    .select('id, start_at, end_at')
    .lt('start_at', new Date(end.getTime() + BUFFER_MINUTES * 60000).toISOString())
    .gt('end_at', new Date(start.getTime() - BUFFER_MINUTES * 60000).toISOString())
    .or(`status.eq.confirmed,and(status.eq.pending_payment,created_at.gte.${pendingCutoff})`);

  if (busyError) {
    res.status(500).json({ error: 'No se pudo verificar disponibilidad' });
    return;
  }
  if (busy && busy.length > 0) {
    res.status(409).json({ error: 'Ese horario ya no está disponible. Por favor elige otro.' });
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
      status: 'pending_payment',
      deposit_cents: totalDeposit,
      price_cents: totalPrice,
      service_label: serviceLabel,
    })
    .select()
    .single();

  if (insertError || !appointment) {
    res.status(500).json({ error: 'No se pudo crear la reserva' });
    return;
  }

  if (totalDeposit === 0) {
    // No deposit required (e.g. addon-only edge case) — confirm immediately.
    await supabase.from('appointments').update({ status: 'confirmed' }).eq('id', appointment.id);
    res.status(200).json({ checkoutUrl: null, appointmentId: appointment.id, confirmed: true });
    return;
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;

  try {
    const session = await getStripe().checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: clientEmail.trim(),
      line_items: [
        {
          price_data: {
            currency: 'usd',
            unit_amount: totalDeposit,
            product_data: {
              name: `Depósito — ${serviceLabel}`,
              description: `Rosas Nails Art · ${start.toLocaleString('es-US', { timeZone: TIMEZONE })}`,
            },
          },
          quantity: 1,
        },
      ],
      metadata: { appointment_id: appointment.id },
      success_url: `${origin}/booking.html?success=1&appointment=${appointment.id}`,
      cancel_url: `${origin}/booking.html?cancelled=1`,
    });

    await supabase.from('appointments').update({ stripe_session_id: session.id }).eq('id', appointment.id);

    res.status(200).json({ checkoutUrl: session.url, appointmentId: appointment.id });
  } catch (err) {
    await supabase.from('appointments').delete().eq('id', appointment.id);
    res.status(500).json({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' });
  }
};
