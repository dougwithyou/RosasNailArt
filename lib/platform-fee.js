// Rosas Nails Art — platform commission on the deposit charged at booking.
// Only the deposit is ever processed through Stripe (the remainder of the
// service price is paid in person, outside the app), so this is the only
// amount the platform can take a cut of.
//
// Stripe's own card processing fee is ~2.9% of the charge; the platform
// fee is set to 2.1% so the two combined land around 5% of the deposit.
const PLATFORM_FEE_PERCENT = 2.1;

function computeApplicationFeeCents(depositCents) {
  return Math.round(depositCents * (PLATFORM_FEE_PERCENT / 100));
}

module.exports = { computeApplicationFeeCents };
