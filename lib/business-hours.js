// Rosas Nails Art — scheduling rules.
// Which days/hours are bookable is no longer fixed here — Maribel opens
// specific windows via the `open_slots` table from her admin panel.
const TIMEZONE = 'America/New_York';

const BUFFER_MINUTES = 10;
const MIN_NOTICE_MINUTES = 120;
const BOOKING_HORIZON_DAYS = 60;
const PENDING_HOLD_MINUTES = 10;
const SLOT_STEP_MINUTES = 15;

module.exports = {
  TIMEZONE,
  BUFFER_MINUTES,
  MIN_NOTICE_MINUTES,
  BOOKING_HORIZON_DAYS,
  PENDING_HOLD_MINUTES,
  SLOT_STEP_MINUTES,
};
