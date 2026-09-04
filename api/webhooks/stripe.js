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

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    res.status(400).send(`Webhook signature verification failed`);
    return;
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
    // Appointment is already confirmed in the DB; email failure shouldn't fail the webhook.
  }

  res.status(200).json({ received: true });
};
