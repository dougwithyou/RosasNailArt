// Rosas Nails Art — scheduling rules.
// Which days/hours are bookable is no longer fixed here — Maribel opens
// specific windows via the `open_slots` table from her admin panel.
const TIMEZONE = 'America/New_York';

// Values below come directly from Maribel's answers (Respuestas_Maribel.pdf):
// 35 min cleanup between appointments, 1 day minimum notice, bookable up to
// 3 weeks out, and a flat $45 deposit per appointment regardless of service.
const BUFFER_MINUTES = 35;
const MIN_NOTICE_MINUTES = 24 * 60;
const BOOKING_HORIZON_DAYS = 21;
const PENDING_HOLD_MINUTES = 10;
const SLOT_STEP_MINUTES = 15;
const DEPOSIT_CENTS = 4500;

module.exports = {
  TIMEZONE,
  BUFFER_MINUTES,
  MIN_NOTICE_MINUTES,
  BOOKING_HORIZON_DAYS,
  PENDING_HOLD_MINUTES,
  SLOT_STEP_MINUTES,
  DEPOSIT_CENTS,
};
