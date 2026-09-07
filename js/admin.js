/**
 * ROSAS NAILS ART — Admin panel (Maribel)
 */
(function () {
'use strict';

const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

const SUPABASE_URL = 'https://ypezkqlcvwswkxblmasm.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlwZXprcWxjdndzd2t4YmxtYXNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg1MzIyNTgsImV4cCI6MjEwNDEwODI1OH0.oH3V8ZXcnfi2saEF-JQCQmD-EB_w97b1rj4AASlE4SI';

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const DOW_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const STATUS_LABELS = { confirmed: 'Confirmada', pending_payment: 'Pendiente de pago' };

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const state = {
  weekStart: startOfWeek(new Date()),
  viewMode: 'week',
  monthCursor: startOfMonth(new Date()),
  selectedDay: null,
};

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfWeek(d) {
  const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = date.getDay();
  date.setDate(date.getDate() - day);
  return date;
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function money(cents) {
  return `$${(cents / 100).toFixed(2)}`;
}

async function authHeader() {
  const { data } = await sb.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...(await authHeader()), ...(options.headers || {}) };
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error');
  return data;
}

// ── Auth screens ──────────────────────────────────
function showLoggedOut() {
  $('#admin-login').hidden = false;
  $('#admin-shell').hidden = true;
}
function showLoggedIn() {
  $('#admin-login').hidden = true;
  $('#admin-shell').hidden = false;
  loadAgenda();
  loadOpenSlots();
  loadServices();
}

async function initAuth() {
  const { data } = await sb.auth.getSession();
  if (data.session) showLoggedIn();
  else showLoggedOut();

  sb.auth.onAuthStateChange((_event, session) => {
    if (session) showLoggedIn();
    else showLoggedOut();
  });

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('#login-error');
    errorEl.hidden = true;
    const form = e.target;
    const { error } = await sb.auth.signInWithPassword({
      email: form.email.value,
      password: form.password.value,
    });
    if (error) {
      errorEl.textContent = 'Email o contraseña incorrectos.';
      errorEl.hidden = false;
    }
  });

  $('#btn-logout').addEventListener('click', () => sb.auth.signOut());
}

// ── Tabs ──────────────────────────────────────────
function initTabs() {
  $$('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      $$('.admin-tab').forEach((t) => t.classList.remove('active'));
      tab.classList.add('active');
      const name = tab.dataset.tab;
      $$('[data-tab-panel]').forEach((p) => (p.hidden = p.dataset.tabPanel !== name));
    });
  });
}

// ── Agenda ────────────────────────────────────────
function renderDayCard(day, dayAppointments, dayOpenSlots) {
  const key = dateKey(day);
  const section = document.createElement('div');
  section.className = 'agenda-day';
  section.innerHTML = `<h4>${DOW_LABELS[day.getDay()]} ${key}</h4>`;

  const openWrap = document.createElement('div');
  openWrap.className = 'agenda-day__open';
  if (!dayOpenSlots.length) {
    openWrap.innerHTML = '<p class="agenda-empty">Sin horarios abiertos</p>';
  } else {
    openWrap.innerHTML = dayOpenSlots
      .map((s) => `<span class="agenda-open-chip">🟢 ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)} disponible</span>`)
      .join('');
  }
  section.appendChild(openWrap);

  if (!dayAppointments.length) {
    const empty = document.createElement('p');
    empty.className = 'agenda-empty';
    empty.textContent = 'Sin citas reservadas';
    section.appendChild(empty);
  } else {
    dayAppointments.forEach((a) => {
      const time = new Date(a.start_at).toLocaleTimeString('es-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      const item = document.createElement('div');
      item.className = 'agenda-item';
      item.innerHTML = `
        <div class="agenda-item__time">${time}</div>
        <div class="agenda-item__meta">
          <b>${a.client_name}</b> — ${a.service_label}<br>
          ${a.client_phone} · ${money(a.price_cents)} (depósito ${money(a.deposit_cents)})
        </div>
        <div class="agenda-item__status ${a.status}">${STATUS_LABELS[a.status] || a.status}</div>
        <div class="agenda-item__actions">
          <button type="button" data-notify="reschedule">Reagendar</button>
          <button type="button" data-notify="late">Voy tarde</button>
          <button type="button" data-notify="custom">Mensaje</button>
        </div>
      `;
      $$('[data-notify]', item).forEach((btn) => {
        btn.addEventListener('click', () => sendAppointmentNotice(a, btn.dataset.notify));
      });
      section.appendChild(item);
    });
  }
  return section;
}

async function fetchRange(from, to) {
  const [{ appointments }, { openSlots }] = await Promise.all([
    apiFetch(`/api/admin/appointments?from=${from}&to=${to}`),
    apiFetch(`/api/admin/open-slots?from=${from.slice(0, 10)}&to=${to.slice(0, 10)}`),
  ]);
  return { appointments, openSlots };
}

async function loadAgenda() {
  if (state.viewMode === 'month') return loadMonthView();
  return loadWeekView();
}

async function loadWeekView() {
  $('#agenda-month-grid').hidden = true;
  $('#agenda-list').hidden = false;

  const weekEnd = new Date(state.weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  $('#agenda-label').textContent = `${dateKey(state.weekStart)} — ${dateKey(weekEnd)}`;

  const list = $('#agenda-list');
  list.innerHTML = '<p class="agenda-empty">Cargando…</p>';

  try {
    const toDate = new Date(weekEnd);
    toDate.setHours(23, 59, 59, 999);
    const { appointments, openSlots } = await fetchRange(state.weekStart.toISOString(), toDate.toISOString());

    list.innerHTML = '';
    for (let i = 0; i < 7; i++) {
      const day = new Date(state.weekStart);
      day.setDate(day.getDate() + i);
      const key = dateKey(day);
      const dayAppointments = appointments.filter((a) => a.start_at.slice(0, 10) === key);
      const dayOpenSlots = openSlots.filter((s) => s.date === key);
      list.appendChild(renderDayCard(day, dayAppointments, dayOpenSlots));
    }
  } catch (err) {
    list.innerHTML = '<p class="agenda-empty">No se pudo cargar la agenda.</p>';
  }
}

async function loadMonthView() {
  const grid = $('#agenda-month-grid');
  const list = $('#agenda-list');
  grid.hidden = false;

  $('#agenda-label').textContent = `${MONTH_LABELS[state.monthCursor.getMonth()]} ${state.monthCursor.getFullYear()}`;

  const monthStart = state.monthCursor;
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);

  grid.innerHTML = '<p class="agenda-empty">Cargando…</p>';
  list.innerHTML = '';

  try {
    const { appointments, openSlots } = await fetchRange(monthStart.toISOString(), monthEnd.toISOString());

    const apptCountByDay = {};
    appointments.forEach((a) => {
      const key = a.start_at.slice(0, 10);
      apptCountByDay[key] = (apptCountByDay[key] || 0) + 1;
    });
    const openCountByDay = {};
    openSlots.forEach((s) => {
      openCountByDay[s.date] = (openCountByDay[s.date] || 0) + 1;
    });

    grid.innerHTML = '';
    ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'].forEach((d) => {
      const el = document.createElement('div');
      el.className = 'cal-dow';
      el.textContent = d;
      grid.appendChild(el);
    });

    const leadingBlanks = monthStart.getDay();
    for (let i = 0; i < leadingBlanks; i++) {
      const el = document.createElement('div');
      el.className = 'cal-day empty';
      grid.appendChild(el);
    }

    const daysInMonth = monthEnd.getDate();
    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      const key = dateKey(d);
      const el = document.createElement('div');
      el.className = 'cal-day enabled' + (state.selectedDay === key ? ' selected' : '');
      const apptCount = apptCountByDay[key] || 0;
      const openCount = openCountByDay[key] || 0;
      el.innerHTML = `
        <span class="cal-day__num">${day}</span>
        ${openCount ? `<span class="cal-day__dot cal-day__dot--open"></span>` : ''}
        ${apptCount ? `<span class="cal-day__dot cal-day__dot--booked">${apptCount}</span>` : ''}
      `;
      el.addEventListener('click', () => {
        state.selectedDay = key;
        const dayAppointments = appointments.filter((a) => a.start_at.slice(0, 10) === key);
        const dayOpenSlots = openSlots.filter((s) => s.date === key);
        list.innerHTML = '';
        list.appendChild(renderDayCard(d, dayAppointments, dayOpenSlots));
        $$('.cal-day', grid).forEach((c) => c.classList.remove('selected'));
        el.classList.add('selected');
      });
      grid.appendChild(el);
    }
  } catch (err) {
    grid.innerHTML = '<p class="agenda-empty">No se pudo cargar el mes.</p>';
  }
}

function initAgendaNav() {
  $$('.agenda-view-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.agenda-view-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.viewMode = btn.dataset.view;
      state.selectedDay = null;
      $('#agenda-list').innerHTML = '';
      loadAgenda();
    });
  });

  $('#agenda-prev').addEventListener('click', () => {
    if (state.viewMode === 'month') {
      state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() - 1, 1);
    } else {
      state.weekStart.setDate(state.weekStart.getDate() - 7);
    }
    loadAgenda();
  });
  $('#agenda-next').addEventListener('click', () => {
    if (state.viewMode === 'month') {
      state.monthCursor = new Date(state.monthCursor.getFullYear(), state.monthCursor.getMonth() + 1, 1);
    } else {
      state.weekStart.setDate(state.weekStart.getDate() + 7);
    }
    loadAgenda();
  });
}

// ── Horarios (open slots) ────────────────────────
async function loadOpenSlots() {
  const list = $('#openslots-list');
  list.innerHTML = '<p class="agenda-empty">Cargando…</p>';

  try {
    const today = dateKey(new Date());
    const { openSlots } = await apiFetch(`/api/admin/open-slots?from=${today}`);
    if (!openSlots.length) {
      list.innerHTML = '<p class="agenda-empty">No has abierto horarios futuros todavía.</p>';
      return;
    }
    list.innerHTML = '';
    openSlots.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'openslot-row';
      row.innerHTML = `
        <span>${s.date} · ${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}</span>
        <button type="button" data-id="${s.id}">Quitar</button>
      `;
      $('button', row).addEventListener('click', async () => {
        try {
          await apiFetch(`/api/admin/open-slots/${s.id}`, { method: 'DELETE' });
          loadOpenSlots();
        } catch (err) {
          alert('No se pudo quitar el horario.');
        }
      });
      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = '<p class="agenda-empty">No se pudo cargar.</p>';
  }
}

function initOpenSlotForm() {
  $('#openslot-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('#openslot-error');
    errorEl.hidden = true;
    const form = e.target;
    try {
      await apiFetch('/api/admin/open-slots', {
        method: 'POST',
        body: JSON.stringify({
          date: form.date.value,
          startTime: form.startTime.value,
          endTime: form.endTime.value,
        }),
      });
      form.reset();
      form.startTime.value = '09:30';
      form.endTime.value = '18:30';
      loadOpenSlots();
    } catch (err) {
      errorEl.textContent = err.message || 'No se pudo abrir el horario.';
      errorEl.hidden = false;
    }
  });
}

// ── Servicios ─────────────────────────────────────
async function loadServices() {
  const list = $('#services-list');
  list.innerHTML = '<p class="agenda-empty">Cargando…</p>';

  try {
    const { services } = await apiFetch('/api/admin/services');
    list.innerHTML = '';
    services.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'service-row';
      row.innerHTML = `
        <input type="text" value="${s.name}" data-field="name">
        <input type="number" value="${s.duration_minutes}" min="1" data-field="durationMinutes" title="Duración (min)">
        <input type="number" value="${(s.price_cents / 100).toFixed(2)}" min="0" step="0.01" data-field="priceCents" title="Precio ($)">
        <label><input type="checkbox" data-field="active" ${s.active ? 'checked' : ''}> Activo</label>
        <button type="button" class="btn btn--secondary" data-save>Guardar</button>
      `;

      $('[data-save]', row).addEventListener('click', async () => {
        const payload = { id: s.id };
        payload.name = $('[data-field=name]', row).value;
        payload.durationMinutes = parseInt($('[data-field=durationMinutes]', row).value, 10);
        payload.priceCents = Math.round(parseFloat($('[data-field=priceCents]', row).value) * 100);
        payload.active = $('[data-field=active]', row).checked;

        try {
          await apiFetch('/api/admin/services', { method: 'PUT', body: JSON.stringify(payload) });
        } catch (err) {
          alert('No se pudo guardar el servicio.');
        }
      });

      list.appendChild(row);
    });
  } catch (err) {
    list.innerHTML = '<p class="agenda-empty">No se pudieron cargar los servicios.</p>';
  }
}

function initServiceForm() {
  $('#service-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.target;
    try {
      await apiFetch('/api/admin/services', {
        method: 'POST',
        body: JSON.stringify({
          name: form.name.value,
          durationMinutes: parseInt(form.durationMinutes.value, 10),
          priceCents: Math.round(parseFloat(form.price.value) * 100),
          depositCents: Math.round(parseFloat(form.deposit.value) * 100),
          category: form.category.value,
        }),
      });
      form.reset();
      loadServices();
    } catch (err) {
      alert('No se pudo agregar el servicio.');
    }
  });
}

// ── Notificaciones ────────────────────────────────
async function sendAppointmentNotice(appointment, type) {
  let customMessage;
  if (type === 'custom') {
    customMessage = prompt(`Mensaje para ${appointment.client_name}:`);
    if (!customMessage?.trim()) return;
  } else if (!confirm(`¿Enviar aviso de "${type === 'reschedule' ? 'reagendar' : 'voy tarde'}" a ${appointment.client_name}?`)) {
    return;
  }

  try {
    await apiFetch('/api/admin/notify', {
      method: 'POST',
      body: JSON.stringify({ appointmentId: appointment.id, type, customMessage }),
    });
    alert('Mensaje enviado.');
  } catch (err) {
    alert('No se pudo enviar el mensaje.');
  }
}

const BROADCAST_TEMPLATES = {
  promo: {
    subject: '✨ Promoción especial en Rosas Nails Art',
    message: 'Tenemos una promoción especial esta semana. ¡Escríbenos o reserva tu cita para aprovecharla!',
  },
  'new-hours': {
    subject: 'Nuevos horarios disponibles — Rosas Nails Art',
    message: 'Abrimos nuevos horarios para las próximas semanas. Entra a reservar tu cita antes de que se llenen.',
  },
  vacation: {
    subject: 'Estaremos cerradas — Rosas Nails Art',
    message: 'Les avisamos que estaremos cerradas por vacaciones. Ya estamos de vuelta pronto — ¡gracias por su paciencia!',
  },
};

async function loadBroadcastCount() {
  const el = $('#broadcast-count');
  try {
    const { recipientCount } = await apiFetch('/api/admin/broadcast');
    el.textContent = `Se enviará a ${recipientCount} clienta(s) que han reservado antes.`;
  } catch (err) {
    el.textContent = 'No se pudo calcular las destinatarias.';
  }
}

function initBroadcast() {
  $('#broadcast-template').addEventListener('change', (e) => {
    const tpl = BROADCAST_TEMPLATES[e.target.value];
    const form = $('#broadcast-form');
    if (tpl) {
      form.subject.value = tpl.subject;
      form.message.value = tpl.message;
    } else {
      form.subject.value = '';
      form.message.value = '';
    }
  });

  $('#broadcast-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('#broadcast-error');
    errorEl.hidden = true;
    const form = e.target;

    if (!confirm('¿Enviar este anuncio a todas las clientas?')) return;

    try {
      const { recipientCount } = await apiFetch('/api/admin/broadcast', {
        method: 'POST',
        body: JSON.stringify({ subject: form.subject.value, message: form.message.value }),
      });
      alert(`Anuncio enviado a ${recipientCount} clienta(s).`);
      form.reset();
    } catch (err) {
      errorEl.textContent = err.message || 'No se pudo enviar el anuncio.';
      errorEl.hidden = false;
    }
  });
}

// ── Init ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  if (!$('.admin-page')) return;
  initAuth();
  initTabs();
  initAgendaNav();
  initOpenSlotForm();
  initServiceForm();
  initBroadcast();
  loadBroadcastCount();
});

})();
