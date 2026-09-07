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

// ── Phase 2: notifications from Maribel's admin panel ──────────────────

const RESCHEDULE_TEMPLATE = (clientName, when) => `
  <p>Hola ${clientName},</p>
  <p>Necesitamos reagendar tu cita del <b>${when}</b> en Rosas Nails Art.</p>
  <p>Escríbenos por WhatsApp al +1 (571) 513-8905 para elegir una nueva fecha y hora que te acomode.</p>
  <p>¡Gracias por tu comprensión! — Rosas Nails Art</p>
`;

const LATE_TEMPLATE = (clientName, when) => `
  <p>Hola ${clientName},</p>
  <p>Te escribimos porque vamos a llegar un poco tarde a tu cita del <b>${when}</b> en Rosas Nails Art.</p>
  <p>Te avisaremos apenas estemos listas para atenderte. ¡Gracias por tu paciencia!</p>
  <p>— Rosas Nails Art</p>
`;

function templateForType(type, clientName, when) {
  if (type === 'reschedule') return RESCHEDULE_TEMPLATE(clientName, when);
  if (type === 'late') return LATE_TEMPLATE(clientName, when);
  return null;
}

async function sendAppointmentNotice({ to, clientName, startAt, type, customMessage }) {
  const when = new Date(startAt).toLocaleString('es-US', {
    timeZone: 'America/New_York',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });

  const subjects = {
    reschedule: 'Necesitamos reagendar tu cita — Rosas Nails Art',
    late: 'Vamos a llegar un poco tarde — Rosas Nails Art',
    custom: 'Mensaje de Rosas Nails Art sobre tu cita',
  };

  const html =
    templateForType(type, clientName, when) ||
    `<p>Hola ${clientName},</p><p>${customMessage}</p><p>— Rosas Nails Art</p>`;

  return getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: subjects[type] || subjects.custom,
    html,
  });
}

async function sendCancellationEmail({ to, clientName, serviceName, startAt, rescheduleUrl, refunded }) {
  const when = new Date(startAt).toLocaleString('es-US', {
    timeZone: 'America/New_York',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  const refundLine = refunded
    ? '<p>Tu depósito ya fue reembolsado a tu método de pago original (puede tardar unos días en reflejarse).</p>'
    : '';
  return getResend().emails.send({
    from: process.env.RESEND_FROM_EMAIL,
    to,
    subject: `Tu cita fue cancelada — Rosas Nails Art (${when})`,
    html: `
      <p>Hola ${clientName},</p>
      <p>Tu cita de <b>${serviceName}</b> del <b>${when}</b> fue cancelada.</p>
      ${refundLine}
      <p><a href="${rescheduleUrl}">Reagenda tu cita aquí</a> cuando gustes.</p>
      <p>¡Gracias por tu comprensión! — Rosas Nails Art</p>
    `,
  });
}

// Broadcasts (promotions, new availability, holiday closures) to every
// distinct client who has booked before. Resend's batch endpoint accepts
// up to 100 emails per call, so callers should chunk larger lists.
async function sendBroadcast(recipients, { subject, message }) {
  if (!recipients.length) return { data: [] };
  const emails = recipients.map(({ email, name }) => ({
    from: process.env.RESEND_FROM_EMAIL,
    to: email,
    subject,
    html: `<p>Hola ${name || 'hermosa'},</p><p>${message}</p><p>— Rosas Nails Art</p>`,
  }));
  return getResend().batch.send(emails);
}

module.exports = {
  sendClientConfirmation,
  sendOwnerNotification,
  sendAppointmentNotice,
  sendCancellationEmail,
  sendBroadcast,
};
