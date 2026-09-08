const { getSupabase } = require('../lib/supabase');
const { requireRole } = require('../lib/auth');

const BUCKET = 'site-images';
// Vercel's default body size limit for a serverless function request is
// 4.5MB, and base64 inflates a file by ~33% — 3MB raw stays safely under that.
const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

// Serves the editable landing-page content (public GET, no auth — index.html
// hydrates from this on load) and lets the superadmin update it or upload a
// photo. Kept as one function (mode-dispatched) rather than separate files
// to stay within Vercel's 12 Serverless Functions cap.
module.exports = async function handler(req, res) {
  const supabase = getSupabase();

  if (req.method === 'GET') {
    const { data, error } = await supabase.from('site_content').select('content').eq('id', true).single();
    if (error) {
      res.status(500).json({ error: 'No se pudo cargar el contenido' });
      return;
    }
    res.status(200).json({ content: data?.content || {} });
    return;
  }

  // Everything past this point changes site content — superadmin only.
  const user = await requireRole(req, res, ['superadmin']);
  if (!user) return;

  if (req.method === 'PUT') {
    const { content } = req.body || {};
    if (!content || typeof content !== 'object') {
      res.status(400).json({ error: 'Contenido inválido' });
      return;
    }

    const { error } = await supabase
      .from('site_content')
      .update({ content, updated_at: new Date().toISOString() })
      .eq('id', true);

    if (error) {
      res.status(500).json({ error: 'No se pudo guardar el contenido' });
      return;
    }
    res.status(200).json({ saved: true });
    return;
  }

  if (req.method === 'POST') {
    const { fileBase64, fileName, contentType } = req.body || {};
    if (!fileBase64 || !fileName || !contentType?.startsWith('image/')) {
      res.status(400).json({ error: 'Archivo inválido' });
      return;
    }

    const buffer = Buffer.from(fileBase64, 'base64');
    if (buffer.length > MAX_UPLOAD_BYTES) {
      res.status(400).json({ error: 'La imagen es muy pesada (máximo 3MB)' });
      return;
    }

    const ext = (fileName.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, buffer, {
      contentType,
      upsert: false,
    });

    if (uploadError) {
      console.error('Failed to upload site image', uploadError);
      res.status(500).json({ error: 'No se pudo subir la imagen' });
      return;
    }

    const { data: publicUrlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
    res.status(200).json({ url: publicUrlData.publicUrl });
    return;
  }

  res.status(405).json({ error: 'Method not allowed' });
};
