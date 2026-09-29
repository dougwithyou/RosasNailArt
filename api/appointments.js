const Stripe = require('stripe');
const { getSupabase } = require('../lib/supabase');
const { TIMEZONE, BUFFER_MINUTES, MIN_NOTICE_MINUTES, BOOKING_HORIZON_DAYS, PENDING_HOLD_MINUTES, DEPOSIT_CENTS } = require('../lib/business-hours');
const { zonedTimeToUtc } = require('../lib/timezone');
const { computeApplicationFeeCents } = require('../lib/platform-fee');

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

  const { serviceId, addonIds, startAt, clientName, clientPhone, clientEmail, notes, paymentType } = req.body || {};

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
  const [{ data: services, error: servicesError }, { data: settings }] = await Promise.all([
    supabase.from('services').select('id, name, duration_minutes, price_cents, active').in('id', allIds),
    supabase.from('business_settings').select('stripe_account_id, payment_policy').eq('id', true).maybeSingle(),
  ]);

  if (servicesError || !services || services.length !== allIds.length || services.some((s) => !s.active)) {
    res.status(400).json({ error: 'Servicio no válido' });
    return;
  }

  // Maribel can force "solo depósito" or "pago total" from her panel — in
  // that case the client's own choice (if any) is overridden here, so the
  // policy is enforced server-side rather than trusted from the request.
  const paymentPolicy = settings?.payment_policy || 'client_choice';
  const chosenPaymentType =
    paymentPolicy === 'deposit_only' ? 'deposit' : paymentPolicy === 'full_only' ? 'full' : paymentType === 'full' ? 'full' : 'deposit';

  const totalDuration = services.reduce((sum, s) => sum + s.duration_minutes, 0);
  const totalPrice = services.reduce((sum, s) => sum + s.price_cents, 0);
  // Flat deposit per appointment (Maribel's policy), not per service line.
  const totalDeposit = DEPOSIT_CENTS;
  // What actually gets charged at booking — the flat deposit, or the full
  // service price if the client chose (or was required) to pay it upfront.
  const chargeCents = chosenPaymentType === 'full' ? totalPrice : totalDeposit;
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
      payment_type: chosenPaymentType,
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

  // Once Maribel has connected her own Stripe account, deposits are charged
  // directly on it (a Connect "direct charge") so the money lands in her
  // balance instead of the platform's.
  const connectedAccountId = settings?.stripe_account_id || null;
  const stripeRequestOptions = connectedAccountId ? { stripeAccount: connectedAccountId } : undefined;

  // The platform's commission only applies when the charge actually lands
  // in Maribel's connected account (a direct charge) — with no connected
  // account, the money already goes straight to the platform, so there's
  // nothing to take a cut of. It's computed on whatever is actually
  // charged now (deposit or full price), not always the flat deposit.
  const applicationFeeCents = connectedAccountId ? computeApplicationFeeCents(chargeCents) : 0;

  try {
    const session = await getStripe().checkout.sessions.create(
      {
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: clientEmail.trim(),
        line_items: [
          {
            price_data: {
              currency: 'usd',
              unit_amount: chargeCents,
              product_data: {
                name: `${chosenPaymentType === 'full' ? 'Pago completo' : 'Depósito'} — ${serviceLabel}`,
                description: `Rosas Nails Art · ${start.toLocaleString('es-US', { timeZone: TIMEZONE })}`,
              },
            },
            quantity: 1,
          },
        ],
        ...(applicationFeeCents > 0 ? { payment_intent_data: { application_fee_amount: applicationFeeCents } } : {}),
        metadata: { appointment_id: appointment.id },
        success_url: `${origin}/booking.html?success=1&appointment=${appointment.id}`,
        cancel_url: `${origin}/booking.html?cancelled=1`,
      },
      stripeRequestOptions
    );

    await supabase
      .from('appointments')
      .update({ stripe_session_id: session.id, stripe_account_id: connectedAccountId })
      .eq('id', appointment.id);

    res.status(200).json({ checkoutUrl: session.url, appointmentId: appointment.id });
  } catch (err) {
    await supabase.from('appointments').delete().eq('id', appointment.id);
    res.status(500).json({ error: 'No se pudo iniciar el pago. Intenta de nuevo.' });
  }
};
