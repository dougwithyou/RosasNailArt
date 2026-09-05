const { getSupabase } = require('../lib/supabase');

function page({ title, message }) {
  return `<!DOCTYPE html>
<html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title} — Rosas Nails Art</title>
<style>
  body{font-family:Montserrat,sans-serif;background:#faf8f9;color:#161316;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;padding:24px;text-align:center}
  .card{max-width:420px;background:#fff;border:1px solid #f1eeef;border-radius:26px;padding:40px}
  h1{font-size:1.3rem;margin-bottom:12px}
  p{color:#6b6266;line-height:1.6}
  a{color:#a97e2f;font-weight:600;text-decoration:none}
</style></head>
<body><div class="card"><h1>${title}</h1><p>${message}</p><p><a href="/index.html">Volver al inicio</a></p></div></body></html>`;
}

module.exports = async function handler(req, res) {
  const { token } = req.query;
  if (!token) {
    res.status(400).send(page({ title: 'Enlace inválido', message: 'Falta el código de confirmación.' }));
    return;
  }

  const supabase = getSupabase();
  const { data: appointment, error } = await supabase
    .from('appointments')
    .select('id, attendance_confirmed_at, status')
    .eq('confirmation_token', token)
    .maybeSingle();

  if (error || !appointment) {
    res.status(404).send(page({ title: 'No encontramos tu cita', message: 'Este enlace ya no es válido.' }));
    return;
  }

  if (!appointment.attendance_confirmed_at) {
    await supabase
      .from('appointments')
      .update({ attendance_confirmed_at: new Date().toISOString() })
      .eq('id', appointment.id);
  }

  res.status(200).send(
    page({ title: '¡Gracias por confirmar!', message: 'Te esperamos en Rosas Nails Art. Nos vemos pronto ✨' })
  );
};
