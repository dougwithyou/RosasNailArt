// Rosas Nails Art — business rules for scheduling
const TIMEZONE = 'America/New_York';

// Monday–Friday, 9:30am–6:30pm
const WORK_DAYS = [1, 2, 3, 4, 5]; // 0=Sun ... 6=Sat
const OPEN_HOUR = 9;
const OPEN_MINUTE = 30;
const CLOSE_HOUR = 18;
const CLOSE_MINUTE = 30;

const BUFFER_MINUTES = 10;
const MIN_NOTICE_MINUTES = 120;
const BOOKING_HORIZON_DAYS = 60;
const PENDING_HOLD_MINUTES = 10;
const SLOT_STEP_MINUTES = 15;

module.exports = {
  TIMEZONE,
  WORK_DAYS,
  OPEN_HOUR,
  OPEN_MINUTE,
  CLOSE_HOUR,
  CLOSE_MINUTE,
  BUFFER_MINUTES,
  MIN_NOTICE_MINUTES,
  BOOKING_HORIZON_DAYS,
  PENDING_HOLD_MINUTES,
  SLOT_STEP_MINUTES,
};
