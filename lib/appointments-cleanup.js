const { PENDING_HOLD_MINUTES } = require('./business-hours');

// A booking that never finishes checkout (closed the tab, card declined,
// changed her mind) stays in 'pending_payment' forever unless something
// moves it along — the availability checks already treat it as free after
// PENDING_HOLD_MINUTES, but the row itself never changes status, so it
// lingers in Maribel's agenda looking like a live unpaid appointment.
// Called opportunistically from the admin endpoints that list appointments
// instead of running as a scheduled job.
async function sweepExpiredAppointments(supabase) {
  const cutoff = new Date(Date.now() - PENDING_HOLD_MINUTES * 60000).toISOString();
  await supabase.from('appointments').update({ status: 'expired' }).eq('status', 'pending_payment').lt('created_at', cutoff);
}

module.exports = { sweepExpiredAppointments };
