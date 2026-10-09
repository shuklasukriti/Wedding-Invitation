"use strict";

let INVITATION_CONFIG = null;
let introState = "loading";
let introVideoUrl = null;

const MOBILE_LAYOUT_QUERY = "(max-width: 719px), (pointer: coarse)";

const elements = {
  loading: document.getElementById("loading-state"),
  loadingText: document.getElementById("loading-text"),
  introScene: document.getElementById("intro-scene"),
  introVideo: document.getElementById("intro-video"),
  introPlay: document.getElementById("intro-play"),
  introPrompt: document.getElementById("intro-prompt"),
  bookStage: document.getElementById("book-stage"),
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
    populateInterface(INVITATION_CONFIG);
    renderInvitationSections(INVITATION_CONFIG.pages);
    elements.bookContainer.addEventListener("click", handleBookAction);
    initializeCountdowns();

    await Promise.all([
      applyTheme(INVITATION_CONFIG),
      loadIntroVideo(INVITATION_CONFIG.assets.introVideo)
    ]);
    bindIntroEvents();
    introState = "ready";
    elements.loading.hidden = true;
    elements.introScene.hidden = false;
    elements.introPlay.disabled = false;
    elements.introPlay.focus({ preventScroll: true });
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
  if (!config.assets || !config.theme?.colors || !config.ui) {
    throw new TypeError("INVITATION_CONFIG is missing a required global section.");
  }
  ["mobile", "desktop"].forEach(device => {
    const path = config.assets.introVideo?.[device];
    if (typeof path !== "string" || !path.trim()) {
      throw new TypeError(`assets.introVideo.${device} must be a video file path.`);
    }
  });
  ["loadingText", "introSceneAriaLabel", "introPlayAriaLabel", "introPromptText", "introPlaybackErrorText"]
    .forEach(key => {
      if (typeof config.ui[key] !== "string" || !config.ui[key].trim()) {
        throw new TypeError(`ui.${key} must be non-empty text.`);
      }
    });
  ["introFadeDelayMs", "introFadeDurationMs", "contentEnterDelayMs", "contentEnterDurationMs",
    "contentStaggerMs", "countdownRollDurationMs", "loaderTurnDurationMs"].forEach(key => {
    const value = config.theme.motion?.[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new TypeError(`theme.motion.${key} must be a non-negative number of milliseconds.`);
    }
  });
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
  const sharedPaperTexture = window.matchMedia(MOBILE_LAYOUT_QUERY).matches
    ? assets.mobilePaperTexture || assets.sharedPaperTexture
    : assets.sharedPaperTexture;
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
    "--ink-muted": theme.colors.inkMuted,
    "--content-enter-delay": `${theme.motion.contentEnterDelayMs}ms`,
    "--content-enter-duration": `${theme.motion.contentEnterDurationMs}ms`,
    "--content-stagger": `${theme.motion.contentStaggerMs}ms`,
    "--loader-turn-duration": `${theme.motion.loaderTurnDurationMs}ms`
  };

  Object.entries(variables).forEach(([property, value]) => {
    if (typeof value === "string" && value.trim()) {
      root.style.setProperty(property, value);
    }
  });

  const optionalTextures = await Promise.all([
    probeImage(bookletTexture),
    probeImage(assets.goldFoilOverlay)
  ]);
  ["--paper-image", "--gold-image"]
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
  const { ui } = config;
  elements.loadingText.textContent = ui.loadingText;
  document.title = ui.documentTitle;
  document.querySelector('meta[name="description"]')?.setAttribute("content", ui.metaDescription);
  elements.introScene.setAttribute("aria-label", ui.introSceneAriaLabel);
  elements.introPlay.setAttribute("aria-label", ui.introPlayAriaLabel);
  elements.introPrompt.textContent = ui.introPromptText;
  elements.bookContainer.setAttribute("aria-label", ui.bookAriaLabel);
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
          ], { duration: INVITATION_CONFIG.theme.motion.countdownRollDurationMs, easing: "cubic-bezier(0.4, 0, 0.2, 1)" });
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

async function loadIntroVideo(sources) {
  const mobile = window.matchMedia(MOBILE_LAYOUT_QUERY).matches;
  const path = mobile ? sources.mobile : sources.desktop;
  elements.introVideo.classList.toggle("is-mobile", mobile);
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Intro video request failed with status ${response.status}`);
  }

  // A local blob guarantees the entire video is downloaded, unlike preload or canplaythrough.
  const videoBlob = await response.blob();
  if (!videoBlob.size) {
    throw new Error("The intro video file is empty.");
  }
  introVideoUrl = URL.createObjectURL(videoBlob);

  await new Promise((resolve, reject) => {
    const video = elements.introVideo;
    const cleanup = () => {
      video.removeEventListener("canplay", onReady);
      video.removeEventListener("error", onError);
    };
    const onReady = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`The intro video could not be decoded (media error ${video.error?.code}).`));
    };
    video.addEventListener("canplay", onReady);
    video.addEventListener("error", onError);
    video.src = introVideoUrl;
    video.load();
  });
}

function bindIntroEvents() {
  elements.introPlay.addEventListener("click", playIntro);
  elements.introVideo.addEventListener("ended", revealInvitation);
  elements.introVideo.addEventListener("pause", () => {
    if (introState !== "playing" || elements.introVideo.ended) return;
    introState = "ready";
    elements.introPlay.hidden = false;
    elements.introPrompt.textContent = INVITATION_CONFIG.ui.introPromptText;
  });
  elements.introVideo.addEventListener("error", () => {
    if (introState === "complete" || introState === "error") return;
    console.error(`Intro video playback failed (media error ${elements.introVideo.error?.code}).`);
    showLoadError(INVITATION_CONFIG.ui);
  });
}

async function playIntro() {
  if (introState !== "ready") return;
  introState = "playing";
  elements.introPlay.hidden = true;
  try {
    await elements.introVideo.play();
  } catch (error) {
    console.error("Intro video playback could not start.", error);
    if (introState !== "playing") return;
    introState = "ready";
    elements.introPrompt.textContent = INVITATION_CONFIG.ui.introPlaybackErrorText;
    elements.introPlay.hidden = false;
    elements.introPlay.focus({ preventScroll: true });
  }
}

function revealInvitation() {
  if (introState !== "playing") return;
  introState = "revealing";
  elements.bookStage.hidden = false;

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    finishIntro();
    return;
  }

  const timing = {
    delay: INVITATION_CONFIG.theme.motion.introFadeDelayMs,
    duration: INVITATION_CONFIG.theme.motion.introFadeDurationMs,
    easing: "ease-in-out",
    fill: "backwards"
  };
  // Fade only the video over opaque paper to avoid a dark dip between translucent layers.
  const fade = elements.introScene.animate([{ opacity: 1 }, { opacity: 0 }], timing);
  fade.addEventListener("finish", finishIntro, { once: true });
}

function finishIntro() {
  introState = "complete";
  elements.introScene.hidden = true;
  document.body.classList.add("invitation-ready");
  elements.bookStage.removeAttribute("aria-hidden");
  elements.bookStage.inert = false;
  document.body.classList.remove("intro-active");
  releaseIntroVideo();
  elements.bookContainer.focus({ preventScroll: true });
}

function releaseIntroVideo() {
  elements.introVideo.removeAttribute("src");
  elements.introVideo.load();
  if (introVideoUrl) {
    URL.revokeObjectURL(introVideoUrl);
    introVideoUrl = null;
  }
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
  introState = "error";
  elements.loading.hidden = true;
  elements.introScene.hidden = true;
  elements.bookStage.hidden = true;
  document.body.classList.remove("intro-active", "invitation-ready");
  releaseIntroVideo();
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