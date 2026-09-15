/**
 * ROSAS NAILS ART — Language detection + manual switcher + static text
 * translation. First visit uses the browser's language; from then on
 * (including if the visitor clicks the EN/ES toggle in the header) their
 * saved choice always wins. Remembered via localStorage across pages.
 * Free-text content Maribel writes herself from the superadmin CMS is
 * left as-is — only the site's own fixed copy (nav, buttons, section
 * headings, default fallback text) is translated here.
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'rosas_lang';

  var dict = {
    es: {
      'nav.inicio': 'Inicio',
      'nav.servicios': 'Servicios',
      'nav.galeria': 'Galería',
      'nav.nosotras': 'Nosotras',
      'nav.cursos': 'Cursos',
      'nav.contacto': 'Contacto',
      'nav.reservar': 'Reservar cita',
      'nav.reservarArrow': 'Reservar cita →',
      'nav.menuLabel': 'Menú',
      'nav.homeLabel': 'Rosas Nails Art — Inicio',
      'nav.langToggle': 'EN',
      'nav.langToggleLabel': 'Switch to English',

      'hero.introEyebrow': 'Hola hermosa',
      'hero.introTitleHtml': 'Bienvenida a<br>tu espacio',
      'hero.scrollCue': 'Desliza para explorar',
      'hero.eyebrow': 'Hola hermosa — bienvenida a tu espacio',
      'hero.titleMain': 'Cuidado de uñas con un toque',
      'hero.titleAccent': 'verdaderamente elegante',
      'hero.subtitle': 'Manicure, pedicure y diseños personalizados en un ambiente pensado para que te sientas consentida de principio a fin.',
      'hero.ctaBooking': 'Reservar mi cita →',
      'hero.ctaServices': 'Ver servicios',
      'hero.chipHtml': '<b>+500</b> clientas felices desde que abrimos en Manassas',
      'hero.ratingLabel': 'Calificación en Google',

      'services.eyebrow': 'Lo que ofrecemos',
      'services.title': 'Nuestros servicios',
      'services.subtitle': 'Cada servicio incluye limpieza y preparación completa de la uña antes de comenzar.',
      'services.basicManicure.desc': 'Limpieza, forma, cuidado de cutícula y esmalte a tu elección para un acabado limpio y hermoso.',
      'services.builderGel.desc': 'Aplicación de Builder Gel y el color en gel que prefieras, para un acabado fuerte, natural y duradero.',
      'services.acrylic.desc': 'Extensiones acrílicas personalizadas al largo y forma que prefieras. Elige el tamaño al reservar: Short $125 · Medium $135 · Extra Long $170.',
      'services.classicPedicure.desc': 'Limpieza y preparación de la uña, forma, cuidado de cutícula y el color de esmalte que elijas.',
      'services.spaPedicure.desc': 'Exfoliación, mascarilla hidratante, vapor y masaje relajante. Experiencia completa de spa para tus pies.',
      'services.combo.desc': 'Limpieza y preparación completa de manos y pies, con el color en gel que elijas para ambos.',
      'services.addonsLabel': 'Add-ons / Extras',
      'services.nailArt.desc': 'Personaliza tu set con diseños a tu gusto.',
      'services.removal.desc': 'Retiro del producto de tu servicio anterior antes de tu nueva cita.',
      'services.handSpa.desc': 'Exfoliación, sales minerales, mascarilla hidratante y vapor para tus manos.',
      'services.paraffin.desc': 'Tratamiento cálido de parafina que suaviza e hidrata la piel de tus manos.',
      'services.swarovskiNote': 'También agregamos Swarovski por un cargo adicional según el diseño — pregúntanos al reservar.',
      'services.allServicesLink': 'Reservar y ver todos los servicios →',

      'gallery.eyebrow': 'Nuestro trabajo',
      'gallery.title': 'Galería de diseños',
      'gallery.tiktokLink': 'Ver más en TikTok →',

      'why.connectTitle': 'Me encantaría conectar contigo',
      'why.follow': 'Síguenos',
      'why.amazonLabel': 'Nuestros productos',
      'why.eyebrow': '¿Por qué elegirnos?',
      'why.titleHtml': 'Tu bienestar es nuestra <span class="accent">prioridad</span>',
      'why.paragraph': 'Un espacio creado especialmente para ti, donde la belleza, el cuidado y la relajación se encuentran. Desde el momento en que llegas, mi objetivo es que te sientas bienvenida, consentida y especial, mientras creamos unas uñas hermosas diseñadas solo para ti. Ven a relajarte, disfruta tu tiempo, y sal sintiéndote hermosa.',
      'why.feature1.title': 'Higiene y esterilización',
      'why.feature1.text': 'Usamos instrumentos esterilizados y materiales desechables en cada servicio. Tu salud primero.',
      'why.feature2.title': 'Técnicas y productos premium',
      'why.feature2.text': 'Solo trabajamos con marcas de alta calidad: OPI, CND, Aprés, Young Nails y más.',
      'why.feature3.title': 'Diseños personalizados',
      'why.feature3.text': 'Traenos tu inspiración o déjate sorprender. Adaptamos cada diseño a tu estilo.',
      'why.feature4.title': 'Ambiente cálido y acogedor',
      'why.feature4.text': 'Un espacio diseñado para que te sientas como en casa desde que llegas.',

      'testimonials.eyebrow': 'Lo que dicen',
      'testimonials.title': 'Opiniones de nuestras clientas',
      'testimonials.subtitle': 'Más de 500 mujeres ya nos eligieron. Esto es lo que piensan.',
      'testimonials.t1': 'Vine por primera vez la semana pasada y quedé absolutamente enamorada del trabajo. Mis uñas quedaron perfectas y el ambiente es hermoso. ¡Volveré siempre!',
      'testimonials.t2': 'El spa pedicure fue una experiencia de lujo. La mascarilla y el masaje fueron increíbles. Super limpio y la atención fue excelente. ¡Definitivamente mi nuevo salón favorito!',
      'testimonials.t3': 'Las extensiones acrílicas me quedaron exactamente como las quería. Les mostré una foto de Instagram y lo replicaron perfecto. ¡Son unas artistas!',

      'courses.eyebrow': 'Aprende con nosotras',
      'courses.titleHtml': '¿Quieres aprender a hacer <span class="accent">uñas</span>?',
      'courses.description': 'Ofrecemos cursos y asesoría personalizada 1 a 1 para que aprendas las técnicas que usamos en el salón, a tu propio ritmo. Escríbenos por WhatsApp y cuéntanos qué te gustaría aprender.',
      'courses.whatsappBtn': 'Quiero más información',

      'cta.eyebrow': '¿Lista para mimarte?',
      'cta.titleHtml': 'Agenda tu cita hoy<br>y date el lujo que mereces',
      'cta.subtitleHtml': 'Atendemos por cita previa.<br>Manassas, Virginia.',
      'cta.bookNow': 'Reservar ahora →',
      'cta.call': 'Llamar',
      'cta.hours': 'Lunes–Viernes · 9:30am – 6:30pm',

      'footer.about': 'Tu espacio de belleza y relajación en el corazón de Manassas, Virginia. Especialistas en uñas con amor y dedicación.',
      'footer.aboutShort': 'Tu espacio de belleza y relajación en el corazón de Manassas, Virginia.',
      'footer.contactHeader': 'Contacto',
      'footer.questionsHeader': '¿Preguntas?',
      'footer.whatsappLink': 'Escríbenos por WhatsApp',
      'footer.callLink': 'Llamar',
      'footer.hours': 'Lun–Vie: 9:30am – 6:30pm',
      'footer.rights': '© 2026 Rosas Nails Art · Todos los derechos reservados',
      'footer.designedBy': 'Diseñado por',

      'booking.metaEyebrow': 'Reserva en 3 pasos',
      'booking.title': 'Agenda tu cita',
      'booking.intro': 'Elige tu servicio, un horario disponible, y confirma con un pequeño depósito. El resto se paga el día de tu cita.',
      'booking.step1': 'Servicio',
      'booking.step2': 'Fecha y hora',
      'booking.step3': 'Tus datos',
      'booking.addonQuestion': '¿Quieres agregar Nail Art & Diseños?',
      'booking.continue': 'Continuar →',
      'booking.back': '← Atrás',
      'booking.chooseDate': 'Elige una fecha',
      'booking.policy': 'El depósito de $45 no es reembolsable y se descuenta del total de tu servicio. Si necesitas reagendar, avísanos con al menos 24 horas de anticipación y tu depósito se transfiere una vez a la nueva cita. Cancelaciones con menos de 24 horas o no presentarte a tu cita implican la pérdida del depósito.',
      'booking.nameLabel': 'Nombre completo',
      'booking.phoneLabel': 'Teléfono',
      'booking.emailLabel': 'Email',
      'booking.notesLabel': 'Notas (opcional)',
      'booking.notesPlaceholder': 'Alguna preferencia o detalle para tu cita',
      'booking.payBtn': 'Pagar depósito y confirmar →',
      'booking.successTitle': '¡Tu cita quedó confirmada!',
      'booking.successText': 'Te enviamos los detalles a tu email. Te esperamos en Rosas Nails Art.',
      'booking.backHome': 'Volver al inicio',
      'booking.prevMonthLabel': 'Mes anterior',
      'booking.nextMonthLabel': 'Mes siguiente',

      'booking.js.dow': ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
      'booking.js.months': ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'],
      'booking.js.locale': 'es-US',
      'booking.js.slotsHeading': 'Horarios disponibles — {date}',
      'booking.js.searchingSlots': 'Buscando horarios…',
      'booking.js.noAvailability': 'No hay citas disponibles en las próximas semanas. Escríbenos por WhatsApp.',
      'booking.js.noSlotsDay': 'No hay horarios disponibles este día. Prueba otra fecha.',
      'booking.js.availabilityError': 'No se pudo cargar la disponibilidad. Intenta de nuevo.',
      'booking.js.summaryService': 'Servicio:',
      'booking.js.summaryDate': 'Fecha:',
      'booking.js.summaryPrice': 'Precio total:',
      'booking.js.summaryDeposit': 'Depósito a pagar ahora:',
      'booking.js.processing': 'Procesando…',
      'booking.js.bookingFailed': 'No se pudo completar la reserva.',
      'booking.js.genericError': 'Ocurrió un error. Intenta de nuevo.',
      'booking.js.cancelledNotice': 'El pago se canceló. Puedes intentar reservar de nuevo cuando quieras.',
      'booking.js.servicesLoadError': 'No se pudieron cargar los servicios. Recarga la página.',
    },
    en: {
      'nav.inicio': 'Home',
      'nav.servicios': 'Services',
      'nav.galeria': 'Gallery',
      'nav.nosotras': 'About',
      'nav.cursos': 'Courses',
      'nav.contacto': 'Contact',
      'nav.reservar': 'Book appointment',
      'nav.reservarArrow': 'Book appointment →',
      'nav.menuLabel': 'Menu',
      'nav.homeLabel': 'Rosas Nails Art — Home',
      'nav.langToggle': 'ES',
      'nav.langToggleLabel': 'Cambiar a español',

      'hero.introEyebrow': 'Hello beautiful',
      'hero.introTitleHtml': 'Welcome to<br>your space',
      'hero.scrollCue': 'Scroll to explore',
      'hero.eyebrow': 'Hello beautiful — welcome to your space',
      'hero.titleMain': 'Nail care with a touch that’s',
      'hero.titleAccent': 'truly elegant',
      'hero.subtitle': 'Manicure, pedicure, and custom nail art in a space designed to make you feel pampered from start to finish.',
      'hero.ctaBooking': 'Book my appointment →',
      'hero.ctaServices': 'View services',
      'hero.chipHtml': '<b>+500</b> happy clients since we opened in Manassas',
      'hero.ratingLabel': 'Google rating',

      'services.eyebrow': 'What we offer',
      'services.title': 'Our services',
      'services.subtitle': 'Every service includes a full nail cleaning and prep before we begin.',
      'services.basicManicure.desc': 'Cleaning, shaping, cuticle care, and the polish of your choice for a clean, beautiful finish.',
      'services.builderGel.desc': 'Builder Gel application with the gel color you prefer, for a strong, natural, long-lasting finish.',
      'services.acrylic.desc': 'Custom acrylic extensions in the length and shape you prefer. Choose your size when booking: Short $125 · Medium $135 · Extra Long $170.',
      'services.classicPedicure.desc': 'Nail cleaning and prep, shaping, cuticle care, and the polish color you choose.',
      'services.spaPedicure.desc': 'Exfoliation, hydrating mask, steam, and a relaxing massage. A full spa experience for your feet.',
      'services.combo.desc': 'Full cleaning and prep for hands and feet, with the gel color you choose for both.',
      'services.addonsLabel': 'Add-ons / Extras',
      'services.nailArt.desc': 'Customize your set with designs of your choice.',
      'services.removal.desc': 'Removal of your previous service’s product before your new appointment.',
      'services.handSpa.desc': 'Exfoliation, mineral salts, hydrating mask, and steam for your hands.',
      'services.paraffin.desc': 'A warm paraffin treatment that softens and hydrates your hands’ skin.',
      'services.swarovskiNote': 'We also add Swarovski crystals for an extra charge depending on the design — just ask when booking.',
      'services.allServicesLink': 'Book now and see all services →',

      'gallery.eyebrow': 'Our work',
      'gallery.title': 'Design gallery',
      'gallery.tiktokLink': 'See more on TikTok →',

      'why.connectTitle': 'I’d love to connect with you',
      'why.follow': 'Follow us',
      'why.amazonLabel': 'Our products',
      'why.eyebrow': 'Why choose us?',
      'why.titleHtml': 'Your wellbeing is our <span class="accent">priority</span>',
      'why.paragraph': 'A space created especially for you, where beauty, care, and relaxation meet. From the moment you arrive, my goal is for you to feel welcomed, pampered, and special, while we create beautiful nails designed just for you. Come relax, enjoy your time, and leave feeling beautiful.',
      'why.feature1.title': 'Hygiene & sterilization',
      'why.feature1.text': 'We use sterilized tools and disposable materials for every service. Your health comes first.',
      'why.feature2.title': 'Premium techniques & products',
      'why.feature2.text': 'We only work with high-quality brands: OPI, CND, Aprés, Young Nails, and more.',
      'why.feature3.title': 'Custom designs',
      'why.feature3.text': 'Bring your inspiration or let us surprise you. We tailor every design to your style.',
      'why.feature4.title': 'Warm & welcoming atmosphere',
      'why.feature4.text': 'A space designed to make you feel at home from the moment you arrive.',

      'testimonials.eyebrow': 'What they say',
      'testimonials.title': 'What our clients say',
      'testimonials.subtitle': 'Over 500 women have already chosen us. Here’s what they think.',
      'testimonials.t1': 'I came for the first time last week and fell absolutely in love with the work. My nails came out perfect and the atmosphere is beautiful. I’ll always come back!',
      'testimonials.t2': 'The spa pedicure was a luxury experience. The mask and massage were incredible. Super clean and the service was excellent. Definitely my new favorite salon!',
      'testimonials.t3': 'My acrylic extensions came out exactly how I wanted. I showed them an Instagram photo and they recreated it perfectly. They’re true artists!',

      'courses.eyebrow': 'Learn with us',
      'courses.titleHtml': 'Want to learn <span class="accent">nail art</span>?',
      'courses.description': 'We offer courses and personalized 1-on-1 mentorship so you can learn the techniques we use in the salon, at your own pace. Message us on WhatsApp and tell us what you’d like to learn.',
      'courses.whatsappBtn': 'I’d like more information',

      'cta.eyebrow': 'Ready to treat yourself?',
      'cta.titleHtml': 'Book your appointment today<br>and treat yourself to the luxury you deserve',
      'cta.subtitleHtml': 'By appointment only.<br>Manassas, Virginia.',
      'cta.bookNow': 'Book now →',
      'cta.call': 'Call',
      'cta.hours': 'Monday–Friday · 9:30am – 6:30pm',

      'footer.about': 'Your space for beauty and relaxation in the heart of Manassas, Virginia. Nail specialists with love and dedication.',
      'footer.aboutShort': 'Your space for beauty and relaxation in the heart of Manassas, Virginia.',
      'footer.contactHeader': 'Contact',
      'footer.questionsHeader': 'Questions?',
      'footer.whatsappLink': 'Message us on WhatsApp',
      'footer.callLink': 'Call',
      'footer.hours': 'Mon–Fri: 9:30am – 6:30pm',
      'footer.rights': '© 2026 Rosas Nails Art · All rights reserved',
      'footer.designedBy': 'Designed by',

      'booking.metaEyebrow': 'Book in 3 steps',
      'booking.title': 'Schedule your appointment',
      'booking.intro': 'Choose your service, an available time, and confirm with a small deposit. You’ll pay the rest the day of your appointment.',
      'booking.step1': 'Service',
      'booking.step2': 'Date & time',
      'booking.step3': 'Your info',
      'booking.addonQuestion': 'Want to add Nail Art & Design?',
      'booking.continue': 'Continue →',
      'booking.back': '← Back',
      'booking.chooseDate': 'Choose a date',
      'booking.policy': 'The $45 deposit is non-refundable and is deducted from your total service price. If you need to reschedule, let us know at least 24 hours in advance and your deposit will transfer once to the new appointment. Cancellations with less than 24 hours’ notice or not showing up mean the deposit is forfeited.',
      'booking.nameLabel': 'Full name',
      'booking.phoneLabel': 'Phone',
      'booking.emailLabel': 'Email',
      'booking.notesLabel': 'Notes (optional)',
      'booking.notesPlaceholder': 'Any preference or detail for your appointment',
      'booking.payBtn': 'Pay deposit & confirm →',
      'booking.successTitle': 'Your appointment is confirmed!',
      'booking.successText': 'We’ve sent the details to your email. See you at Rosas Nails Art.',
      'booking.backHome': 'Back to home',
      'booking.prevMonthLabel': 'Previous month',
      'booking.nextMonthLabel': 'Next month',

      'booking.js.dow': ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
      'booking.js.months': ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
      'booking.js.locale': 'en-US',
      'booking.js.slotsHeading': 'Available times — {date}',
      'booking.js.searchingSlots': 'Looking for times…',
      'booking.js.noAvailability': 'No appointments available in the next few weeks. Message us on WhatsApp.',
      'booking.js.noSlotsDay': 'No times available this day. Try another date.',
      'booking.js.availabilityError': 'Couldn’t load availability. Please try again.',
      'booking.js.summaryService': 'Service:',
      'booking.js.summaryDate': 'Date:',
      'booking.js.summaryPrice': 'Total price:',
      'booking.js.summaryDeposit': 'Deposit due now:',
      'booking.js.processing': 'Processing…',
      'booking.js.bookingFailed': 'We couldn’t complete the booking.',
      'booking.js.genericError': 'Something went wrong. Please try again.',
      'booking.js.cancelledNotice': 'The payment was cancelled. You can try booking again anytime.',
      'booking.js.servicesLoadError': 'We couldn’t load the services. Please reload the page.',
    },
  };

  function detectBrowserLang() {
    return (navigator.language || 'es').toLowerCase().indexOf('en') === 0 ? 'en' : 'es';
  }

  // First visit (nothing saved yet): use the browser's language. After
  // that — including if the visitor ever clicks the toggle — their saved
  // choice always wins, even if it differs from their browser language.
  function getStoredLang() {
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'en' || stored === 'es') return stored;
    } catch (e) {}
    return detectBrowserLang();
  }

  function setLang(newLang) {
    try {
      localStorage.setItem(STORAGE_KEY, newLang);
    } catch (e) {}
    location.reload();
  }

  var lang = getStoredLang();
  document.documentElement.lang = lang;

  function t(key) {
    var table = dict[lang] || dict.es;
    return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : (dict.es[key] !== undefined ? dict.es[key] : key);
  }

  // Marks text we've already translated ourselves as off-limits to the
  // browser's own translate feature (Chrome/Safari), which could
  // otherwise re-translate it a second time and get things like gender
  // agreement wrong.
  function protectFromBrowserTranslate(el) {
    el.setAttribute('translate', 'no');
    el.classList.add('notranslate');
  }

  function applyStaticTranslations() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      el.textContent = t(el.getAttribute('data-i18n'));
      protectFromBrowserTranslate(el);
    });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) {
      el.innerHTML = t(el.getAttribute('data-i18n-html'));
      protectFromBrowserTranslate(el);
    });
    document.querySelectorAll('[data-i18n-attr]').forEach(function (el) {
      el.getAttribute('data-i18n-attr').split(',').forEach(function (pair) {
        var parts = pair.split(':');
        var attr = parts[0].trim();
        var key = parts[1].trim();
        el.setAttribute(attr, t(key));
      });
    });
    document.querySelectorAll('[data-lang-toggle]').forEach(function (btn) {
      btn.textContent = t('nav.langToggle');
      btn.setAttribute('aria-label', t('nav.langToggleLabel'));
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        setLang(lang === 'es' ? 'en' : 'es');
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', applyStaticTranslations);
  } else {
    applyStaticTranslations();
  }

  window.I18N = { lang: lang, t: t, setLang: setLang };
})();
