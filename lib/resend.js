const { Resend } = require('resend');

let client;

function getResend() {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

function formatAppointmentEmail({ clientName, serviceName, startAt, priceCents, depositCents }) {
  const when = new Date(startAt).toLocaleString('es-US', {
    timeZone: 'America/New_York',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  const price = (priceCents / 100).toFixed(2);
  const deposit = (depositCents / 100).toFixed(2);
  return { when, price, deposit };
}

async function sendClientConfirmation({ to, clientName, serviceName, startAt, priceCents, depositCents }) {
  const { when, price, deposit } = formatAppointmentEmail({ clientName, serviceName, startAt, priceCents, depositCents });
  return getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: `Cita confirmada — Rosas Nails Art (${when})`,
    html: `
      <p>Hola ${clientName},</p>
      <p>Tu cita quedó confirmada:</p>
      <ul>
        <li><b>Servicio:</b> ${serviceName}</li>
        <li><b>Fecha y hora:</b> ${when}</li>
        <li><b>Precio total:</b> $${price} (depósito de $${deposit} ya pagado)</li>
      </ul>
      <p>Dirección: 7548 Diplomat Dr B, Suite 201, Manassas, VA 20109</p>
      <p>¡Te esperamos! — Rosas Nails Art</p>
    `,
  });
}

async function sendOwnerNotification({ serviceName, startAt, clientName, clientPhone, clientEmail, priceCents, depositCents }) {
  const { when, price, deposit } = formatAppointmentEmail({ clientName, serviceName, startAt, priceCents, depositCents });
  return getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to: process.env.OWNER_NOTIFICATION_EMAIL,
    subject: `Nueva cita: ${serviceName} — ${when}`,
    html: `
      <p>Nueva cita confirmada y pagada:</p>
      <ul>
        <li><b>Servicio:</b> ${serviceName}</li>
        <li><b>Fecha y hora:</b> ${when}</li>
        <li><b>Clienta:</b> ${clientName}</li>
        <li><b>Teléfono:</b> ${clientPhone}</li>
        <li><b>Email:</b> ${clientEmail}</li>
        <li><b>Precio:</b> $${price} (depósito recibido: $${deposit})</li>
      </ul>
    `,
  });
}

module.exports = { sendClientConfirmation, sendOwnerNotification };
