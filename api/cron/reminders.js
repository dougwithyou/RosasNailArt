const { getSupabase } = require('../../lib/supabase');
const { sendAttendanceReminder } = require('../../lib/resend');

// Called every ~10 min by a scheduler (Vercel Cron or an external one like
// cron-job.org) to email clients whose appointment starts in 25-35 minutes,
// asking them to confirm attendance. Protected by a shared secret so it
// can't be triggered by anyone who finds the URL.
module.exports = async function handler(req, res) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-cron-secret'];
  if (!process.env.CRON_SECRET || token !== process.env.CRON_SECRET) {
    res.status(401).json({ error: 'No autorizado' });
    return;
  }

  const supabase = getSupabase();
  const now = new Date();
  const windowStart = new Date(now.getTime() + 25 * 60000).toISOString();
  const windowEnd = new Date(now.getTime() + 35 * 60000).toISOString();

  const { data: appointments, error } = await supabase
    .from('appointments')
    .select('id, client_email, client_name, service_label, start_at, confirmation_token')
    .eq('status', 'confirmed')
    .is('reminder_sent_at', null)
    .gte('start_at', windowStart)
    .lte('start_at', windowEnd);

  if (error) {
    res.status(500).json({ error: 'No se pudo consultar citas próximas' });
    return;
  }

  const origin = req.headers.origin || `https://${req.headers.host}`;
  let sent = 0;

  for (const appt of appointments || []) {
    try {
      await sendAttendanceReminder({
        to: appt.client_email,
        clientName: appt.client_name,
        serviceName: appt.service_label,
        startAt: appt.start_at,
        confirmUrl: `${origin}/api/confirm-attendance?token=${appt.confirmation_token}`,
      });
      await supabase.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', appt.id);
      sent += 1;
    } catch (err) {
      // Keep going — a delivery failure on one appointment shouldn't block the rest.
    }
  }

  res.status(200).json({ checked: (appointments || []).length, sent });
};
