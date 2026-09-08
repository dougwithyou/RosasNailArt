const Stripe = require('stripe');
const { getSupabase } = require('../../lib/supabase');
const { sendClientConfirmation, sendOwnerNotification } = require('../../lib/resend');

// Vercel needs the raw body to verify the Stripe signature.
module.exports.config = { api: { bodyParser: false } };

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).end();
    return;
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody = await readRawBody(req);
  const signature = req.headers['stripe-signature'];

  // Two separate Stripe webhook endpoints point here, each with its own
  // signing secret: one for events on the platform account (bookings made
  // before Maribel connects Stripe), one for events on her connected
  // account (bookings after). Try both before giving up.
  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (platformErr) {
    if (!process.env.STRIPE_CONNECT_WEBHOOK_SECRET) {
      res.status(400).send('Webhook signature verification failed');
      return;
    }
    try {
      event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_CONNECT_WEBHOOK_SECRET);
    } catch (connectErr) {
      res.status(400).send('Webhook signature verification failed');
      return;
    }
  }

  if (event.type !== 'checkout.session.completed') {
    res.status(200).json({ received: true });
    return;
  }

  const session = event.data.object;
  const appointmentId = session.metadata?.appointment_id;
  if (!appointmentId) {
    res.status(200).json({ received: true });
    return;
  }

  const supabase = getSupabase();

  const { data: appointment, error } = await supabase
    .from('appointments')
    .update({ status: 'confirmed' })
    .eq('id', appointmentId)
    .eq('status', 'pending_payment')
    .select()
    .single();

  if (error || !appointment) {
    // Already confirmed or not found — nothing more to do (avoids double emails on webhook retries).
    res.status(200).json({ received: true });
    return;
  }

  try {
    await Promise.all([
      sendClientConfirmation({
        to: appointment.client_email,
        clientName: appointment.client_name,
        serviceName: appointment.service_label,
        startAt: appointment.start_at,
        priceCents: appointment.price_cents,
        depositCents: appointment.deposit_cents,
      }),
      sendOwnerNotification({
        serviceName: appointment.service_label,
        startAt: appointment.start_at,
        clientName: appointment.client_name,
        clientPhone: appointment.client_phone,
        clientEmail: appointment.client_email,
        priceCents: appointment.price_cents,
        depositCents: appointment.deposit_cents,
      }),
    ]);
  } catch (emailErr) {
    // Appointment is already confirmed in the DB; email failure shouldn't fail the webhook,
    // but it must be visible in Vercel logs — this was previously swallowed silently.
    console.error('Failed to send confirmation emails for appointment', appointmentId, emailErr);
  }

  res.status(200).json({ received: true });
};
