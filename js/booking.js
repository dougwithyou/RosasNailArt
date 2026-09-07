/**
 * ROSAS NAILS ART — Booking wizard
 */
'use strict';

const $ = (s, ctx = document) => ctx.querySelector(s);
const $$ = (s, ctx = document) => [...ctx.querySelectorAll(s)];

const DOW_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const MONTH_LABELS = [
  'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
  'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
];
// Días abiertos los define Maribel desde su panel (no hay un horario fijo) —
// el calendario deja elegir cualquier día futuro dentro del horizonte, y el
// servidor devuelve los horarios reales (vacío si ese día no está abierto).
const BOOKING_HORIZON_DAYS = 21; // 3 semanas, según la política de Maribel
const DEPOSIT_CENTS = 4500; // depósito fijo por cita

const state = {
  services: [],
  addons: [],
  selectedServiceId: null,
  selectedAddonIds: new Set(),
  calendarMonth: startOfMonth(new Date()),
  selectedDate: null, // 'YYYY-MM-DD'
  selectedSlot: null, // ISO string
  step: 1,
};

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function money(cents) {
  return `$${(cents / 100).toFixed(0)}`;
}

function showStatus(message, isError = true) {
  const el = $('#booking-status');
  el.textContent = message;
  el.hidden = false;
  el.style.background = isError ? 'var(--color-rose-lt)' : 'var(--color-surface)';
}
function clearStatus() {
  $('#booking-status').hidden = true;
}

// ── Step navigation ──────────────────────────────
function goToStep(step) {
  state.step = step;
  $$('.booking-panel[data-panel]').forEach((p) => {
    p.hidden = Number(p.dataset.panel) !== step;
  });
  $$('.booking-step').forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('active', n === step);
    el.classList.toggle('done', n < step);
  });
  window.scrollTo({ top: $('.booking-page').offsetTop - 20, behavior: 'smooth' });
}

// ── Load services ────────────────────────────────
async function loadServices() {
  const res = await fetch('/api/services');
  if (!res.ok) throw new Error('services');
  const { services } = await res.json();
  state.services = services.filter((s) => s.category === 'service');
  state.addons = services.filter((s) => s.category === 'addon');
  renderServiceGrid();
}

function renderServiceGrid() {
  const grid = $('#service-select-grid');
  grid.innerHTML = state.services
    .map(
      (s) => `
      <button type="button" class="service-select-card" data-id="${s.id}">
        <h3>${s.name}</h3>
        <div class="service-select-card__meta">
          <span>⏱ ${s.duration_minutes} min</span>
          <b>${money(s.price_cents)}</b>
        </div>
      </button>`
    )
    .join('');

  $$('.service-select-card', grid).forEach((card) => {
    card.addEventListener('click', () => {
      $$('.service-select-card', grid).forEach((c) => c.classList.remove('selected'));
      card.classList.add('selected');
      state.selectedServiceId = card.dataset.id;
      $('#btn-to-step-2').disabled = false;
      renderAddons();
    });
  });
}

function renderAddons() {
  if (!state.addons.length) return;
  const wrap = $('#addon-select');
  const options = $('#addon-options');
  wrap.hidden = false;
  options.innerHTML = state.addons
    .map(
      (a) => `
      <label class="addon-option">
        <input type="checkbox" value="${a.id}">
        ${a.name} — +${a.duration_minutes} min · +${money(a.price_cents)}
      </label>`
    )
    .join('');

  $$('input[type=checkbox]', options).forEach((input) => {
    input.addEventListener('change', () => {
      if (input.checked) state.selectedAddonIds.add(input.value);
      else state.selectedAddonIds.delete(input.value);
    });
  });
}

function totalDurationMinutes() {
  const main = state.services.find((s) => s.id === state.selectedServiceId);
  if (!main) return 0;
  let total = main.duration_minutes;
  state.addons.forEach((a) => {
    if (state.selectedAddonIds.has(a.id)) total += a.duration_minutes;
  });
  return total;
}

function selectedServicesSummary() {
  const main = state.services.find((s) => s.id === state.selectedServiceId);
  const addons = state.addons.filter((a) => state.selectedAddonIds.has(a.id));
  const price = (main?.price_cents || 0) + addons.reduce((sum, a) => sum + a.price_cents, 0);
  const deposit = DEPOSIT_CENTS;
  const label = [main?.name, ...addons.map((a) => a.name)].filter(Boolean).join(' + ');
  return { label, price, deposit };
}

// ── Calendar ──────────────────────────────────────
function isDaySelectable(d) {
  const now = new Date();
  const horizon = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60000);
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return d >= startToday && d <= horizon;
}

function renderCalendar() {
  const label = $('#cal-label');
  label.textContent = `${MONTH_LABELS[state.calendarMonth.getMonth()]} ${state.calendarMonth.getFullYear()}`;

  const grid = $('#calendar-grid');
  grid.innerHTML = '';

  DOW_LABELS.forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-dow';
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstDay = new Date(state.calendarMonth);
  const leadingBlanks = firstDay.getDay();
  for (let i = 0; i < leadingBlanks; i++) {
    const el = document.createElement('div');
    el.className = 'cal-day empty';
    grid.appendChild(el);
  }

  const daysInMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= daysInMonth; day++) {
    const d = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth(), day);
    const el = document.createElement('div');
    const key = dateKey(d);
    const selectable = isDaySelectable(d);
    el.className = 'cal-day' + (selectable ? ' enabled' : '') + (state.selectedDate === key ? ' selected' : '');
    el.textContent = String(day);
    if (selectable) {
      el.addEventListener('click', () => selectDate(key));
    }
    grid.appendChild(el);
  }

  const now = new Date();
  $('#cal-prev').disabled = startOfMonth(state.calendarMonth) <= startOfMonth(now);
  const horizon = new Date(now.getTime() + BOOKING_HORIZON_DAYS * 24 * 60 * 60000);
  $('#cal-next').disabled = startOfMonth(state.calendarMonth) >= startOfMonth(horizon);
}

async function selectDate(key) {
  state.selectedDate = key;
  state.selectedSlot = null;
  $('#btn-to-step-3').disabled = true;
  renderCalendar();

  const slotsGrid = $('#slots-grid');
  $('#slots-heading').textContent = `Horarios disponibles — ${key}`;
  slotsGrid.innerHTML = '<p class="slots-empty">Buscando horarios…</p>';

  try {
    const duration = totalDurationMinutes();
    const res = await fetch(`/api/availability?date=${key}&durationMinutes=${duration}`);
    if (!res.ok) throw new Error('availability');
    const { slots } = await res.json();
    renderSlots(slots);
  } catch (err) {
    slotsGrid.innerHTML = '<p class="slots-empty">No se pudo cargar la disponibilidad. Intenta de nuevo.</p>';
  }
}

function renderSlots(slots) {
  const grid = $('#slots-grid');
  if (!slots.length) {
    grid.innerHTML = '<p class="slots-empty">No hay horarios disponibles este día. Prueba otra fecha.</p>';
    return;
  }
  grid.innerHTML = slots
    .map((iso) => {
      const t = new Date(iso).toLocaleTimeString('es-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' });
      return `<button type="button" class="slot-btn" data-iso="${iso}">${t}</button>`;
    })
    .join('');

  $$('.slot-btn', grid).forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('.slot-btn', grid).forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedSlot = btn.dataset.iso;
      $('#btn-to-step-3').disabled = false;
    });
  });
}

// ── Step 3: summary + submit ─────────────────────
function renderSummary() {
  const { label, price, deposit } = selectedServicesSummary();
  const when = new Date(state.selectedSlot).toLocaleString('es-US', {
    timeZone: 'America/New_York',
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  });
  $('#booking-summary').innerHTML = `
    <div><b>Servicio:</b> ${label}</div>
    <div><b>Fecha:</b> ${when}</div>
    <div><b>Precio total:</b> ${money(price)}</div>
    <div><b>Depósito a pagar ahora:</b> ${money(deposit)}</div>
  `;
}

async function submitBooking(e) {
  e.preventDefault();
  clearStatus();
  const btn = $('#btn-pay');
  btn.disabled = true;
  btn.textContent = 'Procesando…';

  const form = e.target;
  const payload = {
    serviceId: state.selectedServiceId,
    addonIds: [...state.selectedAddonIds],
    startAt: state.selectedSlot,
    clientName: form.clientName.value,
    clientPhone: form.clientPhone.value,
    clientEmail: form.clientEmail.value,
    notes: form.notes.value,
  };

  try {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();

    if (!res.ok) {
      showStatus(data.error || 'No se pudo completar la reserva.');
      btn.disabled = false;
      btn.textContent = 'Pagar depósito y confirmar →';
      return;
    }

    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
      return;
    }

    showSuccess();
  } catch (err) {
    showStatus('Ocurrió un error. Intenta de nuevo.');
    btn.disabled = false;
    btn.textContent = 'Pagar depósito y confirmar →';
  }
}

function showSuccess() {
  $$('.booking-panel[data-panel]').forEach((p) => (p.hidden = true));
  $('#booking-steps').hidden = true;
  $('#panel-success').hidden = false;
}

// ── Init ──────────────────────────────────────────
function initBookingWizard() {
  if (!$('.booking-page')) return;

  const params = new URLSearchParams(window.location.search);
  if (params.get('success') === '1') {
    showSuccess();
    return;
  }
  if (params.get('cancelled') === '1') {
    showStatus('El pago se canceló. Puedes intentar reservar de nuevo cuando quieras.', false);
  }

  loadServices().catch(() => showStatus('No se pudieron cargar los servicios. Recarga la página.'));
  renderCalendar();

  $('#btn-to-step-2').addEventListener('click', () => goToStep(2));
  $('#btn-back-1').addEventListener('click', () => goToStep(1));
  $('#btn-to-step-3').addEventListener('click', () => {
    renderSummary();
    goToStep(3);
  });
  $('#btn-back-2').addEventListener('click', () => goToStep(2));

  $('#cal-prev').addEventListener('click', () => {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() - 1, 1);
    renderCalendar();
  });
  $('#cal-next').addEventListener('click', () => {
    state.calendarMonth = new Date(state.calendarMonth.getFullYear(), state.calendarMonth.getMonth() + 1, 1);
    renderCalendar();
  });

  $('#booking-form').addEventListener('submit', submitBooking);
}

document.addEventListener('DOMContentLoaded', initBookingWizard);
