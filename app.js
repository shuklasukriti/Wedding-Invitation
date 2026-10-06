"use strict";

let INVITATION_CONFIG = null;
let unsealing = false;

const elements = {
  app: document.getElementById("invitation-app"),
  loading: document.getElementById("loading-state"),
  loadingText: document.getElementById("loading-text"),
  envelopeScene: document.getElementById("envelope-scene"),
  envelope: document.getElementById("envelope"),
  envelopeLabelTo: document.getElementById("envelope-label-to"),
  envelopeLabelGuest: document.getElementById("envelope-label-guest"),
  previewMonogram: document.getElementById("preview-monogram"),
  seal: document.getElementById("wax-seal"),
  sealImage: document.getElementById("wax-seal-image"),
  sealMonogram: document.getElementById("seal-monogram"),
  sealPrompt: document.getElementById("seal-prompt"),
  topFlap: document.querySelector(".flap-top"),
  flapInnerShadow: document.querySelector(".flap-inner-shadow"),
  cardPreview: document.querySelector(".invitation-card-preview"),
  tableVignette: document.querySelector(".table-vignette"),
  bookStage: document.getElementById("book-stage"),
  bookShell: document.getElementById("book-shell"),
  bookContainer: document.getElementById("book-container"),
  errorState: document.getElementById("error-state"),
  errorTitle: document.getElementById("error-title"),
  errorBody: document.getElementById("error-body")
};

const TEMPLATE_RENDERERS = {
  COVER: renderCoverTemplate,
  COUNTDOWN: renderCountdownTemplate,
  FAMILY_BLESSINGS: renderFamilyBlessingsTemplate,
  ITINERARY: renderItineraryTemplate,
  LOGISTICS_RSVP: renderLogisticsTemplate
};

boot();

async function boot() {
  try {
    const response = await fetch("config.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Configuration request failed with status ${response.status}`);
    }

    INVITATION_CONFIG = await response.json();
    validateConfig(INVITATION_CONFIG);
    await applyTheme(INVITATION_CONFIG);
    populateInterface(INVITATION_CONFIG);
    renderInvitationSections(INVITATION_CONFIG.pages);
    elements.bookStage.style.visibility = "hidden";
    elements.bookStage.hidden = false;
    bindInterfaceEvents();
    initializeCountdowns();

    elements.loading.hidden = true;
    elements.envelopeScene.hidden = false;
  } catch (error) {
    console.error(error);
    showLoadError(INVITATION_CONFIG?.ui);
  }
}

function validateConfig(config) {
  const requiredTemplates = Object.keys(TEMPLATE_RENDERERS);
  if (!config || typeof config !== "object") {
    throw new TypeError("INVITATION_CONFIG must be an object.");
  }
  if (!config.assets || !config.theme?.colors || !config.envelope || !config.ui) {
    throw new TypeError("INVITATION_CONFIG is missing a required global section.");
  }
  if (!Array.isArray(config.pages) || config.pages.length === 0) {
    throw new TypeError("INVITATION_CONFIG.pages must contain at least one page.");
  }
  if (typeof config.weddingDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/.test(config.weddingDate) ||
    !Number.isFinite(Date.parse(config.weddingDate))) {
    throw new TypeError("weddingDate must be an ISO date and time with seconds and an explicit timezone.");
  }
  const localDate = new Date(config.weddingDate.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "Z"));
  if (localDate.toISOString().slice(0, 19) !== config.weddingDate.slice(0, 19)) {
    throw new TypeError("weddingDate must be a valid calendar date.");
  }

  const pageNumbers = new Set();
  config.pages.forEach((page, index) => {
    if (!requiredTemplates.includes(page.template)) {
      throw new TypeError(`Unsupported page template at index ${index}: ${page.template}`);
    }
    if (!page.content || typeof page.content !== "object") {
      throw new TypeError(`Page ${page.pageNumber ?? index + 1} has no content object.`);
    }
    if (page.template === "ITINERARY" && page.content.events.some(event =>
      !Number.isInteger(event.dayOffset ?? 0))) {
      throw new TypeError("Event dayOffset must be an integer number of days from the wedding date.");
    }
    if (pageNumbers.has(page.pageNumber)) {
      throw new TypeError(`Duplicate pageNumber: ${page.pageNumber}`);
    }
    pageNumbers.add(page.pageNumber);
  });
}

async function applyTheme(config) {
  const root = document.documentElement;
  const { theme, assets } = config;
  const sharedPaperTexture = window.matchMedia("(max-width: 719px), (pointer: coarse)").matches
    ? assets.mobilePaperTexture || assets.sharedPaperTexture
    : assets.sharedPaperTexture;
  const envelopeTexture = sharedPaperTexture || assets.envelopeOuter;
  const bookletTexture = sharedPaperTexture || assets.paperTexture;
  const variables = {
    "--font-display": theme.fontDisplay,
    "--font-heading": theme.fontHeading,
    "--font-body": theme.fontBody,
    "--font-script": theme.fontScript,
    "--primary-maroon": theme.colors.primaryMaroon,
    "--deep-crimson": theme.colors.deepCrimson,
    "--antique-gold": theme.colors.antiqueGold,
    "--gold-sheen": theme.colors.goldLeafSheen,
    "--parchment-bg": theme.colors.parchmentBg,
    "--ink-dark": theme.colors.inkDark,
    "--ink-muted": theme.colors.inkMuted
  };

  Object.entries(variables).forEach(([property, value]) => {
    if (typeof value === "string" && value.trim()) {
      root.style.setProperty(property, value);
    }
  });

  const optionalTextures = await Promise.all([
    probeImage(assets.woodBackdrop),
    probeImage(envelopeTexture),
    probeImage(bookletTexture),
    probeImage(assets.goldFoilOverlay)
  ]);
  ["--wood-image", "--envelope-image", "--paper-image", "--gold-image"]
    .forEach((property, index) => root.style.setProperty(property, optionalTextures[index]));

  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme.colors.deepCrimson);
}

function probeImage(path) {
  if (!path) return Promise.resolve("none");
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(toCssUrl(path));
    image.onerror = () => resolve("none");
    image.src = path;
  });
}

function toCssUrl(path) {
  if (!path) return "none";
  return `url("${String(path).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}")`;
}

function populateInterface(config) {
  const { envelope, ui, assets } = config;
  elements.loadingText.textContent = ui.loadingText;
  document.title = ui.documentTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", ui.metaDescription);
  elements.envelopeLabelTo.textContent = envelope.outerLabel.to;
  elements.envelopeLabelGuest.textContent = envelope.outerLabel.guestPlaceholder;
  elements.previewMonogram.textContent = envelope.sealMonogramText;
  elements.sealMonogram.textContent = envelope.sealMonogramText;
  elements.sealPrompt.textContent = envelope.sealPromptText;
  elements.seal.setAttribute("aria-label", ui.openSealAriaLabel);
  elements.bookContainer.setAttribute("aria-label", ui.bookAriaLabel);

  elements.sealImage.addEventListener("load", () => {
    elements.sealImage.hidden = false;
    elements.sealMonogram.hidden = false;
    elements.seal.classList.add("has-image");
  }, { once: true });
  elements.sealImage.addEventListener("error", () => {
    elements.sealImage.hidden = true;
    elements.sealMonogram.hidden = false;
    elements.seal.classList.remove("has-image");
  }, { once: true });
  elements.sealImage.src = assets.waxSealTexture;
}

function renderInvitationSections(pages) {
  const fragment = document.createDocumentFragment();
  pages.forEach((page, index) => fragment.append(renderSectionNode(page, index)));
  elements.bookContainer.replaceChildren(fragment);
}

function renderSectionNode(pageData, index) {
  const renderer = TEMPLATE_RENDERERS[pageData.template];
  if (!renderer) {
    throw new TypeError(`No renderer exists for template ${pageData.template}.`);
  }

  const page = document.createElement("section");
  page.className = `page-container page-${pageData.template.toLowerCase()}`;
  page.dataset.pageNumber = String(pageData.pageNumber);
  page.innerHTML = `
    <div class="page-inner-surface">
      ${renderCornerFiligree()}
      <div class="template-content">
        ${renderer(pageData.content)}
      </div>
    </div>
  `;
  const heading = page.querySelector("h1, h2");
  heading.id = `invitation-section-${index + 1}`;
  page.setAttribute("aria-labelledby", heading.id);
  return page;
}

function renderCornerFiligree() {
  const glyph = escapeHtml(INVITATION_CONFIG.theme.motifs.cornerGlyph);
  return `
    <div class="corner-filigree top-left" aria-hidden="true">${glyph}</div>
    <div class="corner-filigree top-right" aria-hidden="true">${glyph}</div>
    <div class="corner-filigree bottom-left" aria-hidden="true">${glyph}</div>
    <div class="corner-filigree bottom-right" aria-hidden="true">${glyph}</div>
  `;
}

function renderDivider() {
  return `<div class="ornament-divider" aria-hidden="true">${escapeHtml(INVITATION_CONFIG.theme.motifs.dividerGlyph)}</div>`;
}

function getWeddingTimezoneOffset() {
  return INVITATION_CONFIG.weddingDate.match(/(?:Z|[+-]\d{2}:\d{2})$/)[0];
}

function getWeddingLocalDate(dayOffset = 0) {
  const date = new Date(INVITATION_CONFIG.weddingDate.replace(/(?:Z|[+-]\d{2}:\d{2})$/, "Z"));
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date;
}

function formatWeddingDate(dayOffset = 0) {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
  }).format(getWeddingLocalDate(dayOffset));
}

function formatWeddingTime() {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "UTC"
  }).format(getWeddingLocalDate());
}

function getEventTimeText(event) {
  const time = event.useWeddingTime ? formatWeddingTime() : event.time;
  return event.timeNote ? `${time} (${event.timeNote})` : time;
}

function renderCoverTemplate(content) {
  const { groom, bride } = content.couple;
  return `
    <div class="ganesha-emblem">
      <img src="${escapeAttribute(INVITATION_CONFIG.assets.ganeshaEmblem)}" alt="${escapeAttribute(content.emblemAlt)}" width="132" height="132">
    </div>
    <p class="cover-invocation">${escapeHtml(content.spiritualInvocation)}</p>
    <p class="cover-shloka">${escapeHtml(content.shloka_l1)}</p>
    <p class="cover-shloka">${escapeHtml(content.shloka_l2)}</p>
    <p class="cover-headline">${escapeHtml(content.headline)}</p>
    <h1 class="cover-title">${escapeHtml(bride.name)} &amp; ${escapeHtml(groom.name)}</h1>
    <div class="couple-panels">
      <div class="partner-block partner-bride">
        <p class="partner-role">${escapeHtml(bride.label)}</p>
        <h2 class="partner-name">${escapeHtml(bride.name)}</h2>
        <p class="partner-details">${escapeHtml(bride.parents)}<br>${escapeHtml(bride.residence)}</p>
      </div>
      <div class="partner-block partner-groom">
        <p class="partner-role">${escapeHtml(groom.label)}</p>
        <h2 class="partner-name">${escapeHtml(groom.name)}</h2>
        <p class="partner-details">${escapeHtml(groom.parents)}<br>${escapeHtml(groom.residence)}</p>
      </div>
    </div>
    <p class="wedding-date">${escapeHtml(formatWeddingDate())}</p>
    <p class="cover-bottom-note">${escapeHtml(content.bottomNote)}</p>
  `;
}

function getCountdownValues(targetTime, now = Date.now()) {
  const totalSeconds = Math.max(0, Math.floor((targetTime - now) / 1000));
  return {
    days: String(Math.floor(totalSeconds / 86400)).padStart(2, "0"),
    hours: String(Math.floor(totalSeconds / 3600) % 24).padStart(2, "0"),
    minutes: String(Math.floor(totalSeconds / 60) % 60).padStart(2, "0"),
    seconds: String(totalSeconds % 60).padStart(2, "0")
  };
}

function renderCountdownTemplate(content) {
  const targetDate = INVITATION_CONFIG.weddingDate;
  const timezone = getWeddingTimezoneOffset();
  const dateLabel = `${formatWeddingDate()} at ${formatWeddingTime()} (UTC${timezone === "Z" ? "" : timezone})`;
  const values = getCountdownValues(Date.parse(targetDate));
  const units = Object.entries(values).map(([unit, value]) => `
    <div class="countdown-unit">
      <span class="countdown-value" data-countdown-unit="${unit}" aria-hidden="true">${renderCountdownDigits(value)}</span>
      <span class="countdown-label">${escapeHtml(content.labels[unit])}</span>
    </div>
  `).join("");
  return `
    <p class="section-badge">${escapeHtml(content.headerBadge)}</p>
    <h2 class="section-title">${escapeHtml(content.title)}</h2>
    ${renderDivider()}
    <div class="countdown-clock" role="timer" aria-live="off" data-target-date="${escapeAttribute(targetDate)}">
      ${units}
      <span class="countdown-summary"></span>
    </div>
    <p class="countdown-date"><time datetime="${escapeAttribute(targetDate)}">${escapeHtml(dateLabel)}</time></p>
    <p class="countdown-message" hidden>${escapeHtml(content.completeMessage)}</p>
  `;
}

function renderCountdownDigits(value) {
  return [...value].map(digit => `
    <span class="countdown-digit" data-digit="${digit}"><span class="countdown-reel"><span>${digit}</span><span></span></span></span>
  `).join("");
}

function initializeCountdowns() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  elements.bookContainer.querySelectorAll(".countdown-clock").forEach(clock => {
    const targetTime = Date.parse(clock.dataset.targetDate);
    const section = clock.closest(".page-countdown");
    const message = section.querySelector(".countdown-message");
    const update = () => {
      const values = getCountdownValues(targetTime);
      Object.entries(values).forEach(([unit, value]) => {
        const counter = clock.querySelector(`[data-countdown-unit="${unit}"]`);
        const digits = [...counter.children];
        if (digits.length !== value.length) {
          counter.innerHTML = renderCountdownDigits(value);
          return;
        }
        [...value].forEach((nextDigit, index) => {
          const digit = digits[index];
          if (digit.dataset.digit === nextDigit) return;
          const reel = digit.firstElementChild;
          reel.getAnimations().forEach(animation => animation.cancel());
          const previous = document.createElement("span");
          const next = document.createElement("span");
          previous.textContent = digit.dataset.digit;
          next.textContent = nextDigit;
          digit.dataset.digit = nextDigit;
          reel.replaceChildren(previous, next);
          const settle = () => {
            previous.textContent = nextDigit;
            next.textContent = "";
          };
          if (reducedMotion.matches || document.hidden || !document.body.classList.contains("invitation-ready")) {
            settle();
            return;
          }
          const animation = reel.animate([
            { transform: "translateY(0)" },
            { transform: "translateY(-50%)" }
          ], { duration: 450, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
          animation.onfinish = () => {
            settle();
            animation.cancel();
          };
        });
      });
      clock.querySelector(".countdown-summary").textContent = Object.entries(values)
        .map(([unit, value]) => `${value} ${clock.querySelector(`[data-countdown-unit="${unit}"]`).nextElementSibling.textContent}`)
        .join(", ");
      message.hidden = Date.now() < targetTime;
      if (!message.hidden) clock.querySelector(".countdown-summary").textContent = message.textContent;
      clearTimeout(timer);
      if (message.hidden) timer = setTimeout(update, 1000 - Date.now() % 1000);
    };
    let timer;
    update();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) update();
    });
  });
}

function renderFamilyBlessingsTemplate(content) {
  const hostItems = content.hostsSection.names
    .map((name) => `<li>${escapeHtml(name)}</li>`)
    .join("");

  return `
    <p class="section-badge">${escapeHtml(content.headerBadge)}</p>
    <h2 class="section-title">${escapeHtml(content.title)}</h2>
    <blockquote class="blessing-quote">${escapeHtml(content.quote)}</blockquote>
    <section class="hosts-block">
      <h3>${escapeHtml(content.hostsSection.title)}</h3>
      <ul class="hosts-list">${hostItems}</ul>
    </section>
    <p class="cultural-message">${escapeHtml(content.culturalMessage)}</p>
  `;
}

function renderItineraryTemplate(content) {
  const eventCards = content.events.map((event) => `
    <article class="event-card">
      <h3>${escapeHtml(event.name)}</h3>
      <p class="event-date">${escapeHtml(formatWeddingDate(event.dayOffset))}</p>
      <div class="event-badges">
        <span class="time-badge">${escapeHtml(getEventTimeText(event))}</span>
        <span class="attire-badge">${escapeHtml(event.attire)}</span>
      </div>
      <p class="event-description">${escapeHtml(event.description)}</p>
    </article>
  `).join("");

  return `
    <p class="section-badge">${escapeHtml(content.headerBadge)}</p>
    <h2 class="section-title">${escapeHtml(content.title)}</h2>
    <div class="events-grid">${eventCards}</div>
  `;
}

function renderLogisticsTemplate(content) {
  const { ui } = INVITATION_CONFIG;
  const phoneLinks = content.rsvpContacts.map((contact) => {
    const phoneHref = contact.phone.replace(/[^+\d]/g, "");
    return `
      <a class="contact-link" href="tel:${escapeAttribute(phoneHref)}" aria-label="${escapeAttribute(`${ui.callButtonPrefix} ${contact.name}`)}">
        <strong>${escapeHtml(contact.name)}</strong>
        <span>${escapeHtml(contact.relation)} · ${escapeHtml(contact.phone)}</span>
      </a>
    `;
  }).join("");

  const actions = [
    `<a class="action-button" href="${escapeAttribute(content.venue.googleMapsUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ui.mapsButtonText)}</a>`
  ];
  if (content.quickActionButtons.enableCalendarExport) {
    actions.push(`<button class="action-button" type="button" data-action="calendar-export">${escapeHtml(ui.calendarButtonText)}</button>`);
  }
  if (content.quickActionButtons.enableDirectWhatsappRsvp) {
    const whatsappUrl = createWhatsappUrl(content.quickActionButtons);
    actions.push(`<a class="action-button" href="${escapeAttribute(whatsappUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(ui.whatsappButtonText)}</a>`);
  }

  return `
    <p class="section-badge">${escapeHtml(content.headerBadge)}</p>
    <h2 class="section-title">${escapeHtml(content.venue.hall)}</h2>
    <section class="venue-block">
      <h3 class="venue-name">${escapeHtml(content.venue.name)}</h3>
      <p class="venue-hall">${escapeHtml(content.venue.hall)}</p>
      <p class="venue-address">${escapeHtml(content.venue.addressLine1)}<br>${escapeHtml(content.venue.cityStatePin)}</p>
    </section>
    <p class="reception-details">${escapeHtml(content.receptionDetails)}</p>
    <div class="action-row${actions.length === 1 ? " single-action" : ""}">${actions.join("")}</div>
    <div class="contacts-list">${phoneLinks}</div>
    <p class="closing-blessing">${escapeHtml(content.closingBlessing)}</p>
  `;
}

function createWhatsappUrl(actions) {
  const number = String(actions.whatsappNumber).replace(/\D/g, "");
  return `https://wa.me/${number}?text=${encodeURIComponent(actions.whatsappPrefilledMessage)}`;
}

function bindInterfaceEvents() {
  elements.seal.addEventListener("click", runUnsealingSequence, { once: true });
  elements.bookContainer.addEventListener("click", handleBookAction);
}

function runUnsealingSequence() {
  if (unsealing) return;
  unsealing = true;
  elements.seal.disabled = true;
  elements.envelopeScene.style.pointerEvents = "none";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!window.gsap || reducedMotion) {
    completeUnsealingWithoutAnimation();
    return;
  }

  const durationScale = 1;
  const mobile = window.matchMedia("(max-width: 719px)").matches;
  const cardBounds = elements.cardPreview.getBoundingClientRect();
  const envelopeBounds = elements.envelope.getBoundingClientRect();
  const extractedCardTop = Math.max(0, (window.innerHeight - cardBounds.height) / 2);
  const flapDepth = elements.topFlap.offsetHeight *
    Number.parseFloat(window.getComputedStyle(elements.topFlap).getPropertyValue("--flap-tip")) / 100;
  const envelopeDrop = Math.max(0, extractedCardTop + cardBounds.height + flapDepth + 32 - envelopeBounds.top);
  const lightEffects = mobile || window.matchMedia("(pointer: coarse)").matches;
  const cardLift = extractedCardTop - cardBounds.top - envelopeDrop;
  const timeline = window.gsap.timeline({ defaults: { ease: "power2.inOut" } });
  const revealTargets = elements.bookContainer.querySelectorAll(".page-inner-surface > *");

  window.gsap.killTweensOf(elements.seal);
  window.gsap.set(elements.seal, { xPercent: -50, yPercent: -50 });
  window.gsap.set(revealTargets, { opacity: 0 });

  timeline
    .to(elements.sealPrompt, { opacity: 0, duration: 0.32 * durationScale }, 0)
    .to(elements.topFlap, {
      rotateX: 90,
      z: 10,
      ...(!lightEffects && { filter: "brightness(0.62) drop-shadow(0 14px 10px rgba(20, 0, 3, 0.48))" }),
      duration: 0.54 * durationScale,
      ease: "power2.in"
    }, 0.34 * durationScale)
    .to(elements.flapInnerShadow, {
      opacity: 0.78,
      duration: 0.54 * durationScale
    }, 0.34 * durationScale)
    .to(elements.topFlap, {
      rotateX: 180,
      z: -2,
      ...(!lightEffects && { filter: "brightness(0.84) drop-shadow(0 -9px 12px rgba(20, 0, 3, 0.32))" }),
      duration: 0.54 * durationScale,
      ease: "power2.out"
    }, 0.88 * durationScale)
    .to(elements.flapInnerShadow, {
      opacity: 0.28,
      duration: 0.54 * durationScale
    }, 0.88 * durationScale)
    .to(elements.seal, {
      scale: 0.96,
      opacity: 0,
      ...(!lightEffects && { filter: "drop-shadow(0 -8px 10px rgba(0, 0, 0, 0.28))" }),
      duration: 0.48 * durationScale,
      ease: "power1.in"
    }, 0.9 * durationScale)
    .set(elements.topFlap, { zIndex: 1 }, 1.43 * durationScale)
    .set(elements.cardPreview, { zIndex: 3 }, 1.43 * durationScale)
    .to(elements.cardPreview.children, {
      opacity: 0,
      duration: 0.26 * durationScale
    }, 1.44 * durationScale)
    .to(elements.envelope, {
      y: envelopeDrop,
      duration: 1.15 * durationScale,
      ease: "power2.inOut"
    }, 1.46 * durationScale)
    .to(elements.cardPreview, {
      y: cardLift,
      duration: 1.15 * durationScale,
      ...(!lightEffects && { boxShadow: "0 18px 24px -12px rgba(23, 0, 2, 0.46), inset 0 0 25px rgba(113, 71, 27, 0.1)" }),
      ease: "power2.inOut"
    }, 1.46 * durationScale)
    .call(promoteCardPreview, [], 2.63 * durationScale)
    .to(elements.cardPreview, {
      top: 0,
      left: 0,
      width: "100vw",
      height: "100dvh",
      borderRadius: 0,
      duration: 0.95 * durationScale,
      ease: "power3.inOut"
    }, 2.66 * durationScale)
    .call(prepareBookStage, [], 3.64 * durationScale)
    .set(elements.bookStage, { opacity: 1 }, 3.64 * durationScale)
    .set(elements.bookShell, { scale: 1 }, 3.64 * durationScale)
    .set(revealTargets, { opacity: 1 }, 3.64 * durationScale)
    .to(elements.cardPreview, {
      opacity: 0,
      duration: 0.42 * durationScale,
      ease: "power1.inOut"
    }, 3.74 * durationScale)
    .call(finishUnsealing);
}

function promoteCardPreview() {
  const bounds = elements.cardPreview.getBoundingClientRect();
  elements.app.append(elements.cardPreview);
  elements.cardPreview.classList.add("is-extracting");
  window.gsap.set(elements.cardPreview, { clearProps: "transform" });
  window.gsap.set(elements.cardPreview, {
    zIndex: 50,
    top: bounds.top,
    left: bounds.left,
    width: bounds.width,
    height: bounds.height,
    x: 0,
    y: 0,
    xPercent: 0,
    yPercent: 0,
    scale: 1
  });
}

function finishUnsealing() {
  elements.envelopeScene.hidden = true;
  elements.envelopeScene.removeAttribute("style");
  elements.bookStage.removeAttribute("aria-hidden");
  elements.bookStage.inert = false;
  elements.cardPreview.remove();
  document.body.classList.add("invitation-ready");
  elements.bookContainer.focus({ preventScroll: true });
}

function prepareBookStage() {
  document.body.classList.add("book-open");
  elements.envelopeScene.hidden = true;
  elements.bookStage.hidden = false;
  elements.bookStage.style.visibility = "";
  elements.bookStage.setAttribute("aria-hidden", "true");
}

function completeUnsealingWithoutAnimation() {
  document.body.classList.add("book-open");
  elements.envelopeScene.hidden = true;
  elements.bookStage.hidden = false;
  elements.bookStage.style.visibility = "";
  elements.bookStage.style.opacity = "1";
  elements.bookShell.style.transform = "scale(1) translateY(0)";
  finishUnsealing();
}

function handleBookAction(event) {
  const calendarButton = event.target.closest?.('[data-action="calendar-export"]');
  if (!calendarButton) return;
  event.preventDefault();
  event.stopPropagation();
  downloadCalendarFile();
}

function downloadCalendarFile() {
  const events = INVITATION_CONFIG.pages
    .filter((page) => page.template === "ITINERARY")
    .flatMap((page) => page.content.events);
  const couple = INVITATION_CONFIG.pages.find((page) => page.template === "COVER")?.content.couple;
  const calendarName = couple ? `${couple.groom.name} & ${couple.bride.name} Wedding` : "Wedding Celebrations";
  const generatedAt = formatCalendarDate(new Date());
  const calendarEvents = events.map((event, index) => {
    const start = parseEventDateTime(event);
    if (!start) return "";
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return [
      "BEGIN:VEVENT",
      `UID:wedding-${index}-${start.getTime()}@invitation.local`,
      `DTSTAMP:${generatedAt}`,
      `DTSTART:${formatCalendarDate(start)}`,
      `DTEND:${formatCalendarDate(end)}`,
      `SUMMARY:${escapeCalendarText(event.name)}`,
      `DESCRIPTION:${escapeCalendarText(`${event.description} Attire: ${event.attire}`)}`,
      "END:VEVENT"
    ].join("\r\n");
  }).filter(Boolean).join("\r\n");

  const calendar = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Wedding Invitation//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeCalendarText(calendarName)}`,
    calendarEvents,
    "END:VCALENDAR"
  ].join("\r\n");

  const downloadUrl = URL.createObjectURL(new Blob([calendar], { type: "text/calendar;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = downloadUrl;
  link.download = "wedding-celebrations.ics";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
}

function parseEventDateTime(event) {
  const date = getWeddingLocalDate(event.dayOffset);
  if (!event.useWeddingTime) {
    const timeMatch = event.time?.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
    if (!timeMatch || Number(timeMatch[1]) < 1 || Number(timeMatch[1]) > 12 || Number(timeMatch[2]) > 59) return null;
    let hour = Number(timeMatch[1]) % 12;
    if (timeMatch[3].toUpperCase() === "PM") hour += 12;
    date.setUTCHours(hour, Number(timeMatch[2]), 0, 0);
  }
  return new Date(`${date.toISOString().slice(0, 19)}${getWeddingTimezoneOffset()}`);
}

function formatCalendarDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeCalendarText(value) {
  return String(value)
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replace(/\r?\n/g, "\\n");
}

function showLoadError(ui = {}) {
  elements.loading.hidden = true;
  elements.envelopeScene.hidden = true;
  elements.bookStage.hidden = true;
  elements.errorTitle.textContent = ui.loadErrorTitle || "The invitation could not be opened";
  elements.errorBody.textContent = ui.loadErrorBody || "Please refresh the page or check your connection.";
  elements.errorState.hidden = false;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}