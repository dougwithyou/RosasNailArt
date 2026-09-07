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

const TIMEZONE = 'America/New_York';
const DOW_LABELS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DOW_LABELS_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const STATUS_LABELS = { confirmed: 'Confirmada', pending_payment: 'Pendiente de pago', cancelled: 'Cancelada' };
const MIN_HOUR_HEIGHT = 30; // px per hour floor in the weekly grid, below which it scrolls instead of shrinking further
const MIN_MONTH_ROW_HEIGHT = 64; // px floor per week row in the month grid

const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];

const PANEL_TITLES = {
  inicio: 'Inicio',
  agenda: 'Agenda',
  horarios: 'Horarios',
  servicios: 'Servicios',
  clientes: 'Clientes',
  notificaciones: 'Notificaciones',
};

const state = {
  weekStart: startOfWeek(new Date()),
  viewMode: 'week',
  monthCursor: startOfMonth(new Date()),
  selectedDay: null,
  currentPanel: 'inicio',
};

let clientsCache = [];
let servicesCache = [];
let lastWeekGridData = null; // { weekStart, appointments, openSlots } — kept for resize re-render

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
function timeToMinutes(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}
// Wall-clock minutes-since-midnight for a UTC instant, as seen in TIMEZONE —
// needed because appointments are timestamptz but open_slots are stored as
// plain local wall-clock times, so both must line up on the same clock.
function easternMinutesOfDay(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
  const minute = Number(parts.find((p) => p.type === 'minute').value);
  return hour * 60 + minute;
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
  loadStats();
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

// ── Sidebar navigation ─────────────────────────────
function switchPanel(name) {
  state.currentPanel = name;
  $$('.sidebar__link').forEach((l) => l.classList.toggle('active', l.dataset.panelLink === name));
  $$('[data-tab-panel]').forEach((p) => (p.hidden = p.dataset.tabPanel !== name));
  $('#topbar-title').textContent = PANEL_TITLES[name] || '';
  closeWeekPopover();

  if (name === 'inicio') loadStats();
  if (name === 'clientes' && !clientsCache.length) loadClients();
  if (name === 'agenda') requestAnimationFrame(() => loadAgenda());
}

function initSidebar() {
  $$('.sidebar__link').forEach((link) => {
    link.addEventListener('click', () => switchPanel(link.dataset.panelLink));
  });
}

// ── Inicio (stats) ─────────────────────────────────
async function loadStats() {
  const wrap = $('#today-appointments-list');
  wrap.innerHTML = '<p class="agenda-empty">Cargando…</p>';

  try {
    const stats = await apiFetch('/api/admin/dashboard?view=stats');
    $('#stat-week-count').textContent = stats.weekApptCount;
    $('#stat-week-deposit').textContent = money(stats.weekDepositTotalCents);
    $('#stat-month-deposit').textContent = money(stats.monthDepositTotalCents);

    if (stats.nextAppointment) {
      const when = new Date(stats.nextAppointment.startAt).toLocaleString('es-US', {
        weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE,
      });
      $('#stat-next-appt').innerHTML = `<b>${stats.nextAppointment.clientName}</b><br>${stats.nextAppointment.serviceLabel}<br>${when}`;
    } else {
      $('#stat-next-appt').textContent = 'No hay citas próximas.';
    }

    renderTodayAppointments(stats.todayAppointments || []);
  } catch (err) {
    wrap.innerHTML = '<p class="agenda-empty">No se pudieron cargar las métricas.</p>';
  }
}

function renderTodayAppointments(list) {
  const wrap = $('#today-appointments-list');
  if (!list.length) {
    wrap.innerHTML = '<p class="agenda-empty">No hay citas hoy.</p>';
    return;
  }
  wrap.innerHTML = list
    .map((t) => {
      const time = new Date(t.startAt).toLocaleTimeString('es-US', { hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE });
      return `
      <div class="agenda-item" data-id="${t.id}">
        <div class="agenda-item__time">${time}</div>
        <div class="agenda-item__meta">
          <button type="button" class="link-btn" data-open-client="${t.phoneKey}"><b>${t.clientName}</b></button> — ${t.serviceLabel}
        </div>
        <div class="agenda-item__status ${t.status}">${STATUS_LABELS[t.status] || t.status}</div>
        <div class="agenda-item__actions">
          <button type="button" data-notify="reschedule">Reagendar</button>
          <button type="button" data-notify="late">Voy tarde</button>
          <button type="button" data-notify="custom">Mensaje</button>
          <button type="button" data-cancel class="danger-link">Cancelar</button>
        </div>
      </div>
    `;
    })
    .join('');

  list.forEach((t) => {
    const item = $(`.agenda-item[data-id="${t.id}"]`, wrap);
    if (!item) return;
    $$('[data-notify]', item).forEach((btn) => {
      btn.addEventListener('click', () => sendAppointmentNotice({ id: t.id, client_name: t.clientName }, btn.dataset.notify));
    });
    $('[data-cancel]', item)?.addEventListener('click', () =>
      cancelAppointment({ id: t.id, client_name: t.clientName, status: t.status }, () => loadStats())
    );
    $('[data-open-client]', item)?.addEventListener('click', (e) => openClientPanel(e.target.dataset.openClient || t.phoneKey));
  });
}

// ── Cancel appointment (shared by Inicio, Agenda popover, day cards) ──
async function cancelAppointment(appointment, onDone) {
  if (!confirm(`¿Cancelar la cita de ${appointment.client_name}? Se le avisará por email${appointment.status === 'confirmed' ? ' y se le reembolsará el depósito' : ''}.`)) {
    return;
  }
  try {
    const result = await apiFetch('/api/admin/appointments', {
      method: 'PATCH',
      body: JSON.stringify({ id: appointment.id, action: 'cancel' }),
    });
    alert(result.refunded ? 'Cita cancelada y depósito reembolsado.' : 'Cita cancelada.');
    if (onDone) onDone();
  } catch (err) {
    alert(err.message || 'No se pudo cancelar la cita.');
  }
}

// ── Agenda ────────────────────────────────────────
function appointmentActionsHtml(a) {
  if (a.status === 'cancelled') return '';
  return `
    <div class="agenda-item__actions">
      <button type="button" data-notify="reschedule">Reagendar</button>
      <button type="button" data-notify="late">Voy tarde</button>
      <button type="button" data-notify="custom">Mensaje</button>
      <button type="button" data-cancel class="danger-link">Cancelar</button>
    </div>
  `;
}

function wireAppointmentActions(container, a, onCancelled) {
  $$('[data-notify]', container).forEach((btn) => {
    btn.addEventListener('click', () => sendAppointmentNotice(a, btn.dataset.notify));
  });
  $('[data-cancel]', container)?.addEventListener('click', () => cancelAppointment(a, onCancelled));
}

function renderDayCard(day, dayAppointments, dayOpenSlots, onCancelled) {
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
      const time = new Date(a.start_at).toLocaleTimeString('es-US', { hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE });
      const item = document.createElement('div');
      item.className = `agenda-item${a.status === 'cancelled' ? ' is-cancelled' : ''}`;
      item.innerHTML = `
        <div class="agenda-item__time">${time}</div>
        <div class="agenda-item__meta">
          <b>${a.client_name}</b> — ${a.service_label}<br>
          ${a.client_phone} · ${money(a.price_cents)} (depósito ${money(a.deposit_cents)})
        </div>
        <div class="agenda-item__status ${a.status}">${STATUS_LABELS[a.status] || a.status}</div>
        ${appointmentActionsHtml(a)}
      `;
      wireAppointmentActions(item, a, onCancelled);
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

function computeGridHours(openSlots) {
  if (!openSlots.length) return { startHour: 9, endHour: 19 };
  let minStart = 24 * 60;
  let maxEnd = 0;
  openSlots.forEach((s) => {
    minStart = Math.min(minStart, timeToMinutes(s.start_time));
    maxEnd = Math.max(maxEnd, timeToMinutes(s.end_time));
  });
  return { startHour: Math.floor(minStart / 60), endHour: Math.ceil(maxEnd / 60) };
}

function formatHourLabel(hour) {
  const h = hour % 24;
  const period = h < 12 ? 'am' : 'pm';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${period}`;
}

// How much vertical room is left below `el`'s top, down to the viewport
// bottom (minus a little breathing room) — used so the week/month grids fill
// the screen instead of needing an inner scrollbar.
function availableHeightBelow(el, bottomPadding) {
  const rect = el.getBoundingClientRect();
  return Math.max(window.innerHeight - rect.top - bottomPadding, 200);
}

function renderWeekGrid(weekStart, appointments, openSlots) {
  const grid = $('#agenda-week-grid');
  grid.innerHTML = '';

  const { startHour, endHour } = computeGridHours(openSlots);
  const hourCount = endHour - startHour;
  const gridStartMin = startHour * 60;

  const headerHeight = 62; // approx height of .week-grid__header, kept in sync with CSS
  const available = availableHeightBelow(grid, 24) - headerHeight;
  const hourHeight = Math.max(Math.floor(available / hourCount), MIN_HOUR_HEIGHT);
  const bodyHeight = hourCount * hourHeight;
  grid.style.setProperty('--hour-h', `${hourHeight}px`);

  const header = document.createElement('div');
  header.className = 'week-grid__header';
  const todayKey = dateKey(new Date());
  let headerHtml = '<div class="week-grid__corner"></div>';
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const isToday = dateKey(d) === todayKey;
    headerHtml += `<div class="week-grid__daylabel ${isToday ? 'is-today' : ''}"><span>${DOW_LABELS_SHORT[d.getDay()]}</span><b>${d.getDate()}</b></div>`;
  }
  header.innerHTML = headerHtml;
  grid.appendChild(header);

  const body = document.createElement('div');
  body.className = 'week-grid__body';

  const times = document.createElement('div');
  times.className = 'week-grid__times';
  times.style.height = `${bodyHeight}px`;
  for (let h = startHour; h < endHour; h++) {
    const lbl = document.createElement('div');
    lbl.className = 'week-grid__time';
    lbl.style.height = `${hourHeight}px`;
    lbl.textContent = formatHourLabel(h);
    times.appendChild(lbl);
  }
  body.appendChild(times);

  for (let i = 0; i < 7; i++) {
    const day = new Date(weekStart);
    day.setDate(day.getDate() + i);
    const key = dateKey(day);

    const col = document.createElement('div');
    col.className = 'week-grid__day';
    col.style.height = `${bodyHeight}px`;

    openSlots
      .filter((s) => s.date === key)
      .forEach((s) => {
        const startMin = timeToMinutes(s.start_time);
        const endMin = timeToMinutes(s.end_time);
        const top = Math.max((startMin - gridStartMin) * (hourHeight / 60), 0);
        const height = Math.max((endMin - startMin) * (hourHeight / 60), 4);
        const el = document.createElement('div');
        el.className = 'week-slot week-slot--open';
        el.style.top = `${top}px`;
        el.style.height = `${height}px`;
        el.textContent = `${s.start_time.slice(0, 5)}–${s.end_time.slice(0, 5)}`;
        col.appendChild(el);
      });

    // Cancelled appointments render first (as dimmed ghosts) so active
    // bookings always paint on top if a slot gets reused.
    const dayAppointments = appointments
      .filter((a) => a.start_at.slice(0, 10) === key)
      .sort((a, b) => (a.status === 'cancelled' ? -1 : 0) - (b.status === 'cancelled' ? -1 : 0));

    dayAppointments.forEach((a) => {
      const startMin = easternMinutesOfDay(new Date(a.start_at));
      const endMin = easternMinutesOfDay(new Date(a.end_at));
      const top = Math.max((startMin - gridStartMin) * (hourHeight / 60), 0);
      const height = Math.max((endMin - startMin) * (hourHeight / 60), 18);
      const timeLabel = new Date(a.start_at).toLocaleTimeString('es-US', { hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE });

      const el = document.createElement('button');
      el.type = 'button';
      el.className = `week-slot week-slot--appt status-${a.status}`;
      el.style.top = `${top}px`;
      el.style.height = `${height}px`;
      el.innerHTML = `<b>${timeLabel}</b> ${a.client_name}`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        openWeekPopover(a, el);
      });
      col.appendChild(el);
    });

    body.appendChild(col);
  }

  grid.appendChild(body);
}

function openWeekPopover(a, anchorEl) {
  const pop = $('#week-popover');
  const body = $('#week-popover-body');
  const time = new Date(a.start_at).toLocaleTimeString('es-US', { hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE });

  body.innerHTML = `
    <h4>${a.client_name}</h4>
    <p class="week-popover__meta">
      ${a.service_label}<br>
      ${time} · ${a.client_phone}<br>
      ${money(a.price_cents)} (depósito ${money(a.deposit_cents)}) ·
      <span class="agenda-item__status ${a.status}">${STATUS_LABELS[a.status] || a.status}</span>
    </p>
    <div class="week-popover__actions">
      ${
        a.status === 'cancelled'
          ? ''
          : `
        <button type="button" data-notify="reschedule">Reagendar</button>
        <button type="button" data-notify="late">Voy tarde</button>
        <button type="button" data-notify="custom">Mensaje</button>
        <button type="button" data-cancel class="danger-link">Cancelar cita</button>
      `
      }
    </div>
  `;
  $$('[data-notify]', body).forEach((btn) => {
    btn.addEventListener('click', () => {
      pop.hidden = true;
      sendAppointmentNotice(a, btn.dataset.notify);
    });
  });
  $('[data-cancel]', body)?.addEventListener('click', () => {
    pop.hidden = true;
    cancelAppointment(a, () => loadAgenda());
  });

  const rect = anchorEl.getBoundingClientRect();
  pop.hidden = false;
  const popRect = pop.getBoundingClientRect();
  const top = Math.min(rect.top, window.innerHeight - popRect.height - 8);
  const left = Math.min(rect.right + 8, window.innerWidth - popRect.width - 8);
  pop.style.top = `${Math.max(top, 8)}px`;
  pop.style.left = `${Math.max(left, 8)}px`;
}

function closeWeekPopover() {
  const pop = $('#week-popover');
  if (pop) pop.hidden = true;
}

document.addEventListener('click', (e) => {
  const pop = $('#week-popover');
  if (!pop || pop.hidden) return;
  if (pop.contains(e.target) || e.target.closest('.week-slot--appt')) return;
  pop.hidden = true;
});

async function loadWeekView() {
  $('#agenda-month-grid').hidden = true;
  $('#agenda-list').hidden = true;
  $('#agenda-week-grid').hidden = false;

  const weekEnd = new Date(state.weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  $('#agenda-label').textContent = `${dateKey(state.weekStart)} — ${dateKey(weekEnd)}`;

  const grid = $('#agenda-week-grid');
  grid.innerHTML = '<p class="agenda-empty">Cargando…</p>';

  try {
    const toDate = new Date(weekEnd);
    toDate.setHours(23, 59, 59, 999);
    const { appointments, openSlots } = await fetchRange(state.weekStart.toISOString(), toDate.toISOString());
    lastWeekGridData = { weekStart: new Date(state.weekStart), appointments, openSlots };
    renderWeekGrid(state.weekStart, appointments, openSlots);
  } catch (err) {
    grid.innerHTML = '<p class="agenda-empty">No se pudo cargar la agenda.</p>';
  }
}

async function loadMonthView() {
  const grid = $('#agenda-month-grid');
  const list = $('#agenda-list');
  $('#agenda-week-grid').hidden = true;
  grid.hidden = false;
  list.hidden = false;

  $('#agenda-label').textContent = `${MONTH_LABELS[state.monthCursor.getMonth()]} ${state.monthCursor.getFullYear()}`;

  const monthStart = state.monthCursor;
  const monthEnd = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0, 23, 59, 59, 999);

  grid.innerHTML = '<p class="agenda-empty">Cargando…</p>';
  list.innerHTML = '';

  try {
    const { appointments, openSlots } = await fetchRange(monthStart.toISOString(), monthEnd.toISOString());

    const apptCountByDay = {};
    appointments.forEach((a) => {
      if (a.status === 'cancelled') return;
      const key = a.start_at.slice(0, 10);
      apptCountByDay[key] = (apptCountByDay[key] || 0) + 1;
    });
    const openCountByDay = {};
    openSlots.forEach((s) => {
      openCountByDay[s.date] = (openCountByDay[s.date] || 0) + 1;
    });

    grid.innerHTML = '';
    DOW_LABELS_SHORT.forEach((d) => {
      const el = document.createElement('div');
      el.className = 'cal-dow';
      el.textContent = d;
      grid.appendChild(el);
    });

    const leadingBlanks = monthStart.getDay();
    const daysInMonth = monthEnd.getDate();
    const rowCount = Math.ceil((leadingBlanks + daysInMonth) / 7);
    const available = availableHeightBelow(grid, 24) - 28; // minus the day-of-week label row
    const rowHeight = Math.max(Math.floor(available / rowCount), MIN_MONTH_ROW_HEIGHT);
    grid.style.setProperty('--month-row-h', `${rowHeight}px`);

    for (let i = 0; i < leadingBlanks; i++) {
      const el = document.createElement('div');
      el.className = 'cal-day empty';
      grid.appendChild(el);
    }

    for (let day = 1; day <= daysInMonth; day++) {
      const d = new Date(monthStart.getFullYear(), monthStart.getMonth(), day);
      const key = dateKey(d);
      const apptCount = apptCountByDay[key] || 0;
      const openCount = openCountByDay[key] || 0;
      const el = document.createElement('div');
      el.className =
        'cal-day enabled' +
        (state.selectedDay === key ? ' selected' : '') +
        (openCount ? ' has-open' : '') +
        (apptCount ? ' has-appts' : '');
      el.innerHTML = `
        <span class="cal-day__num">${day}</span>
        ${apptCount ? `<span class="cal-day__badge">${apptCount} cita${apptCount === 1 ? '' : 's'}</span>` : ''}
        ${openCount && !apptCount ? `<span class="cal-day__badge cal-day__badge--open">Disponible</span>` : ''}
      `;
      el.addEventListener('click', () => {
        state.selectedDay = key;
        const dayAppointments = appointments.filter((a) => a.start_at.slice(0, 10) === key);
        const dayOpenSlots = openSlots.filter((s) => s.date === key);
        list.innerHTML = '';
        list.appendChild(renderDayCard(d, dayAppointments, dayOpenSlots, () => loadMonthView()));
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

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.currentPanel !== 'agenda') return;
      if (state.viewMode === 'week' && lastWeekGridData) {
        renderWeekGrid(lastWeekGridData.weekStart, lastWeekGridData.appointments, lastWeekGridData.openSlots);
      } else if (state.viewMode === 'month') {
        loadMonthView();
      }
    }, 200);
  });
}

// ── Manual appointment creation ───────────────────
function openAddAppointmentModal() {
  const overlay = $('#add-appointment-overlay');
  const form = $('#add-appointment-form');
  form.reset();
  $('#add-appointment-error').hidden = true;

  const select = $('#add-appt-service');
  select.innerHTML = servicesCache
    .filter((s) => s.active)
    .map((s) => `<option value="${s.id}">${s.name} (${s.duration_minutes} min · ${money(s.price_cents)})</option>`)
    .join('');

  const today = dateKey(new Date());
  form.date.min = today;
  form.date.value = today;

  overlay.hidden = false;
}

function closeAddAppointmentModal() {
  $('#add-appointment-overlay').hidden = true;
}

function initAddAppointmentModal() {
  $('#btn-add-appointment').addEventListener('click', openAddAppointmentModal);
  $('#add-appointment-close').addEventListener('click', closeAddAppointmentModal);
  $('#add-appointment-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'add-appointment-overlay') closeAddAppointmentModal();
  });

  $('#add-appointment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('#add-appointment-error');
    errorEl.hidden = true;
    const form = e.target;

    const startAt = new Date(`${form.date.value}T${form.time.value}:00`);
    if (Number.isNaN(startAt.getTime())) {
      errorEl.textContent = 'Fecha u hora inválida.';
      errorEl.hidden = false;
      return;
    }

    try {
      await apiFetch('/api/admin/appointments', {
        method: 'POST',
        body: JSON.stringify({
          serviceId: form.serviceId.value,
          clientName: form.clientName.value,
          clientPhone: form.clientPhone.value,
          clientEmail: form.clientEmail.value,
          startAt: startAt.toISOString(),
          notes: form.notes.value,
        }),
      });
      closeAddAppointmentModal();
      loadAgenda();
      loadStats();
    } catch (err) {
      errorEl.textContent = err.message || 'No se pudo agregar la cita.';
      errorEl.hidden = false;
    }
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
  const form = $('#openslot-form');
  const today = dateKey(new Date());
  form.fromDate.min = today;
  form.toDate.min = today;
  form.fromDate.value = today;
  form.toDate.value = today;

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = $('#openslot-error');
    errorEl.hidden = true;

    const daysOfWeek = $$('input[name="dow"]:checked', form).map((el) => parseInt(el.value, 10));
    if (!daysOfWeek.length) {
      errorEl.textContent = 'Selecciona al menos un día de la semana.';
      errorEl.hidden = false;
      return;
    }
    if (form.fromDate.value > form.toDate.value) {
      errorEl.textContent = '"Desde" no puede ser después de "Hasta".';
      errorEl.hidden = false;
      return;
    }

    try {
      const result = await apiFetch('/api/admin/open-slots', {
        method: 'POST',
        body: JSON.stringify({
          fromDate: form.fromDate.value,
          toDate: form.toDate.value,
          daysOfWeek,
          startTime: form.startTime.value,
          endTime: form.endTime.value,
        }),
      });
      if (!result.created) {
        errorEl.textContent = 'Esos horarios ya estaban abiertos.';
        errorEl.hidden = false;
        return;
      }
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
    servicesCache = services;
    list.innerHTML = '';
    services.forEach((s) => {
      const row = document.createElement('div');
      row.className = 'service-row';
      row.innerHTML = `
        <input type="text" value="${s.name}" data-field="name">
        <input type="number" value="${s.duration_minutes}" min="1" data-field="durationMinutes" title="Duración (min)">
        <input type="number" value="${(s.price_cents / 100).toFixed(2)}" min="0" step="0.01" data-field="priceCents" title="Precio ($)">
        <label><input type="checkbox" data-field="active" ${s.active ? 'checked' : ''}> Activo</label>
        <div class="service-row__buttons">
          <button type="button" class="btn btn--secondary" data-save>Guardar</button>
          <button type="button" class="btn-icon-delete" data-delete title="Borrar servicio">Borrar</button>
        </div>
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

      $('[data-delete]', row).addEventListener('click', async () => {
        if (!confirm(`¿Borrar "${s.name}"?`)) return;
        try {
          const result = await apiFetch('/api/admin/services', { method: 'DELETE', body: JSON.stringify({ id: s.id }) });
          if (result.deactivated) {
            alert(`"${s.name}" tiene citas asociadas, así que se desactivó en vez de borrarse.`);
          }
          loadServices();
        } catch (err) {
          alert('No se pudo borrar el servicio.');
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

// ── Clientes ──────────────────────────────────────
// Clients are grouped by phone number (server-side, via a normalized
// "phoneKey") so the same person appears once even if she used different
// emails across bookings.
async function loadClients() {
  const list = $('#clients-list');
  list.innerHTML = '<p class="agenda-empty">Cargando…</p>';
  try {
    const { clients } = await apiFetch('/api/admin/dashboard?view=clients');
    clientsCache = clients;
    renderClientsList(clients);
  } catch (err) {
    list.innerHTML = '<p class="agenda-empty">No se pudieron cargar las clientas.</p>';
  }
}

function renderClientsList(clients) {
  const list = $('#clients-list');
  if (!clients.length) {
    list.innerHTML = '<p class="agenda-empty">Todavía no hay clientas.</p>';
    return;
  }
  list.innerHTML = clients
    .map(
      (c) => `
    <button type="button" class="client-row" data-phone-key="${c.phoneKey}">
      <span class="client-row__name">${c.name}</span>
      <span class="client-row__meta">${c.phone}${c.emails.length ? ' · ' + c.emails[0] + (c.emails.length > 1 ? ` (+${c.emails.length - 1})` : '') : ''}</span>
    </button>
  `
    )
    .join('');
  $$('.client-row', list).forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.client-row', list).forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      selectClient(btn.dataset.phoneKey);
    });
  });
}

function initClientSearch() {
  $('#client-search').addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    const filtered = !q
      ? clientsCache
      : clientsCache.filter((c) => [c.name, c.phone, ...c.emails].filter(Boolean).some((v) => v.toLowerCase().includes(q)));
    renderClientsList(filtered);
  });
}

function renderClientApptList(container, appointments, isUpcoming) {
  if (!appointments.length) {
    container.innerHTML = `<p class="agenda-empty">${isUpcoming ? 'Sin citas próximas.' : 'Sin citas anteriores.'}</p>`;
    return;
  }
  container.innerHTML = appointments
    .map((a) => {
      const when = new Date(a.start_at).toLocaleString('es-US', {
        weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: TIMEZONE,
      });
      return `
      <div class="agenda-item">
        <div class="agenda-item__time">${when}</div>
        <div class="agenda-item__meta"><b>${a.service_label}</b><br>${money(a.price_cents)}</div>
        <div class="agenda-item__status ${a.status}">${STATUS_LABELS[a.status] || a.status}</div>
      </div>
    `;
    })
    .join('');
}

async function selectClient(phoneKey) {
  const detail = $('#client-detail');
  detail.innerHTML = '<p class="agenda-empty">Cargando…</p>';
  try {
    const { client, upcoming, past } = await apiFetch(`/api/admin/dashboard?view=clients&phone=${encodeURIComponent(phoneKey)}`);
    const emailsLine = client.emails.length > 1 ? `Emails: ${client.emails.join(', ')}` : client.email || '';
    detail.innerHTML = `
      <div class="client-detail__head">
        <h3>${client.name}</h3>
        <p class="client-detail__contact">${client.phone}${emailsLine ? ' · ' + emailsLine : ''}</p>
      </div>
      <div class="client-detail__section">
        <h4>Próximas citas</h4>
        <div class="client-appt-list" id="client-upcoming"></div>
      </div>
      <div class="client-detail__section">
        <h4>Últimas citas</h4>
        <div class="client-appt-list" id="client-past"></div>
      </div>
      <div class="client-detail__section">
        <h4>Enviar mensaje</h4>
        <form id="client-message-form" class="admin-form">
          <textarea name="message" rows="4" placeholder="Escribe un mensaje para ${client.name}…" required></textarea>
          <p class="admin-error" id="client-message-error" hidden></p>
          <button type="submit" class="btn btn--primary">Enviar por email</button>
        </form>
      </div>
    `;
    renderClientApptList($('#client-upcoming'), upcoming, true);
    renderClientApptList($('#client-past'), [...past].reverse(), false);

    $('#client-message-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const errorEl = $('#client-message-error');
      errorEl.hidden = true;
      const form = e.target;
      try {
        await apiFetch('/api/admin/notify', {
          method: 'POST',
          body: JSON.stringify({
            clientEmail: client.email,
            clientName: client.name,
            type: 'custom',
            customMessage: form.message.value,
          }),
        });
        alert('Mensaje enviado.');
        form.reset();
      } catch (err) {
        errorEl.textContent = err.message || 'No se pudo enviar el mensaje.';
        errorEl.hidden = false;
      }
    });
  } catch (err) {
    detail.innerHTML = '<p class="agenda-empty">No se pudo cargar la ficha de la clienta.</p>';
  }
}

async function openClientPanel(phoneKey) {
  switchPanel('clientes');
  if (!clientsCache.length) await loadClients();
  const btn = $$('.client-row').find((b) => b.dataset.phoneKey === phoneKey);
  if (btn) {
    $$('.client-row').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
  }
  selectClient(phoneKey);
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
  initSidebar();
  initAgendaNav();
  initAddAppointmentModal();
  initOpenSlotForm();
  initServiceForm();
  initClientSearch();
  initBroadcast();
  loadBroadcastCount();

  $('#week-popover-close')?.addEventListener('click', closeWeekPopover);
});

})();
