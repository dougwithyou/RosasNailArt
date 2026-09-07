const { createClient } = require('@supabase/supabase-js');

let anonClient;

function getAnonClient() {
  if (!anonClient) {
    anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
  }
  return anonClient;
}

// Verifies the bearer token from the Authorization header and checks the
// caller's role (stored in Supabase Auth app_metadata) is in allowedRoles.
// On failure, writes the response and returns null. On success, returns the user.
async function requireRole(req, res, allowedRoles) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    res.status(401).json({ error: 'No autenticado' });
    return null;
  }

  const { data, error } = await getAnonClient().auth.getUser(token);
  if (error || !data?.user) {
    res.status(401).json({ error: 'Sesión inválida' });
    return null;
  }

  const role = data.user.app_metadata?.role;
  if (!allowedRoles.includes(role)) {
    res.status(403).json({ error: 'No autorizado' });
    return null;
  }

  return data.user;
}

module.exports = { requireRole };
