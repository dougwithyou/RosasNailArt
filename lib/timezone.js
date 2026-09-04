// Minimal IANA timezone <-> UTC conversion without extra dependencies.
// Good enough for scheduling wall-clock business hours (not sub-second precision).

function pad(n) {
  return String(n).padStart(2, '0');
}

function getOffsetMinutes(approxUtcDate, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'longOffset',
  }).formatToParts(approxUtcDate);
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+00:00';
  const match = offsetPart.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const sign = match[1] === '-' ? -1 : 1;
  return sign * (parseInt(match[2], 10) * 60 + parseInt(match[3], 10));
}

// dateStr: 'YYYY-MM-DD', hour/minute: local wall-clock time in timeZone.
function zonedTimeToUtc(dateStr, hour, minute, timeZone) {
  const approx = new Date(`${dateStr}T${pad(hour)}:${pad(minute)}:00Z`);
  const offsetMin = getOffsetMinutes(approx, timeZone);
  return new Date(approx.getTime() - offsetMin * 60000);
}

// Returns { year, month, day, weekday(0-6, Sun=0) } for a UTC instant, as seen in timeZone.
function getZonedDateParts(utcDate, timeZone) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = fmt.formatToParts(utcDate);
  const get = (type) => parts.find((p) => p.type === type)?.value;
  const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    weekday: weekdayMap[get('weekday')],
  };
}

module.exports = { zonedTimeToUtc, getZonedDateParts };
