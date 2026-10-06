"use strict";

let INVITATION_CONFIG = null;
let pageFlip = null;
let fallbackPageIndex = 0;
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
  bookControls: document.getElementById("book-controls"),
  previousPage: document.getElementById("previous-page"),
  nextPage: document.getElementById("next-page"),
  pageStatus: document.getElementById("page-status"),
  errorState: document.getElementById("error-state"),
  errorTitle: document.getElementById("error-title"),
  errorBody: document.getElementById("error-body")
};

const TEMPLATE_RENDERERS = {
  COVER: renderCoverTemplate,
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
    renderBookPages(INVITATION_CONFIG.pages);
    bindInterfaceEvents();

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

  const pageNumbers = new Set();
  config.pages.forEach((page, index) => {
    if (!requiredTemplates.includes(page.template)) {
      throw new TypeError(`Unsupported page template at index ${index}: ${page.template}`);
    }
    if (!page.content || typeof page.content !== "object") {
      throw new TypeError(`Page ${page.pageNumber ?? index + 1} has no content object.`);
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
  const envelopeTexture = assets.sharedPaperTexture || assets.envelopeOuter;
  const bookletTexture = assets.sharedPaperTexture || assets.paperTexture;
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
  elements.previousPage.setAttribute("aria-label", ui.previousPageLabel);
  elements.previousPage.title = ui.previousPageLabel;
  elements.nextPage.setAttribute("aria-label", ui.nextPageLabel);
  elements.nextPage.title = ui.nextPageLabel;
  elements.bookControls.setAttribute("aria-label", ui.bookControlsAriaLabel);
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

function renderBookPages(pages) {
  const fragment = document.createDocumentFragment();
  pages.forEach((page) => fragment.append(renderPageNode(page)));
  elements.bookContainer.replaceChildren(fragment);
}

function renderPageNode(pageData) {
  const renderer = TEMPLATE_RENDERERS[pageData.template];
  if (!renderer) {
    throw new TypeError(`No renderer exists for template ${pageData.template}.`);
  }

  const page = document.createElement("div");
  page.className = `page-container page-${pageData.template.toLowerCase()}`;
  page.dataset.density = "soft";
  page.dataset.pageNumber = String(pageData.pageNumber);
  page.innerHTML = `
    <div class="page-inner-surface">
      ${renderCornerFiligree()}
      <div class="template-content">
        ${renderer(pageData.content)}
        <span class="page-number-mark" aria-hidden="true">${escapeHtml(pageData.pageNumber)}</span>
      </div>
    </div>
  `;
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

function renderCoverTemplate(content) {
  const { groom, bride } = content.couple;
  return `
    <p class="cover-invocation">${escapeHtml(content.spiritualInvocation)}</p>
    <p class="cover-shloka">${escapeHtml(content.shloka)}</p>
    ${renderDivider()}
    <p class="cover-headline">${escapeHtml(content.headline)}</p>
    <h1 class="couple-names">
      <span class="couple-name">${escapeHtml(groom.name)}</span>
      <span class="couple-ampersand">&amp;</span>
      <span class="couple-name">${escapeHtml(bride.name)}</span>
    </h1>
    <div class="couple-details">
      <p>${escapeHtml(groom.parents)}<br>${escapeHtml(groom.residence)}</p>
      <p>${escapeHtml(bride.parents)}<br>${escapeHtml(bride.residence)}</p>
    </div>
    <p class="wedding-date">${escapeHtml(content.weddingDateFormal)}</p>
    <p class="cover-bottom-note">${escapeHtml(content.bottomNote)}</p>
  `;
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
      <p class="event-date">${escapeHtml(event.date)}</p>
      <div class="event-badges">
        <span class="time-badge">${escapeHtml(event.time)}</span>
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
  elements.previousPage.addEventListener("click", () => turnPage(-1));
  elements.nextPage.addEventListener("click", () => turnPage(1));
  elements.bookContainer.addEventListener("click", handleBookAction);
  bindTapNavigation();

  let resizeFrame = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(updateViewportMetrics);
  }, { passive: true });
  updateViewportMetrics();
}

function updateViewportMetrics() {
  document.documentElement.style.setProperty("--viewport-height", `${window.innerHeight}px`);
  if (pageFlip && typeof pageFlip.update === "function") {
    pageFlip.update();
  }
}

function runUnsealingSequence() {
  if (unsealing) return;
  unsealing = true;
  elements.seal.disabled = true;
  elements.envelopeScene.style.pointerEvents = "none";

  if (!window.gsap) {
    completeUnsealingWithoutAnimation();
    return;
  }

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const durationScale = reducedMotion ? 0.05 : 1;
  const envelopeDrop = Math.min(window.innerHeight * 0.16, 140);
  const cardLift = window.matchMedia("(max-width: 719px)").matches ? "-112%" : "-165%";
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
      filter: "brightness(0.62) drop-shadow(0 14px 10px rgba(20, 0, 3, 0.48))",
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
      filter: "brightness(0.84) drop-shadow(0 -9px 12px rgba(20, 0, 3, 0.32))",
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
      filter: "drop-shadow(0 -8px 10px rgba(0, 0, 0, 0.28))",
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
      boxShadow: "0 18px 24px -12px rgba(23, 0, 2, 0.46), inset 0 0 25px rgba(113, 71, 27, 0.1)",
      ease: "power2.inOut"
    }, 1.46 * durationScale)
    .call(promoteCardPreview, [], 2.63 * durationScale)
    .to(elements.envelope, {
      scale: 0.9,
      opacity: 0,
      duration: 0.58 * durationScale,
      ease: "power2.in"
    }, 2.64 * durationScale)
    .to(elements.tableVignette, {
      scale: 0.92,
      opacity: 0,
      duration: 0.58 * durationScale
    }, 2.64 * durationScale)
    .to(elements.cardPreview, {
      top: 0,
      left: 0,
      width: "100vw",
      height: "100dvh",
      borderRadius: 0,
      duration: 0.95 * durationScale,
      ease: "power3.inOut"
    }, 2.66 * durationScale)
    .call(prepareBookStage, [], 3.61 * durationScale)
    .set(elements.bookStage, { opacity: 1 }, 3.61 * durationScale)
    .to(elements.bookShell, {
      scale: 1,
      duration: 0.48 * durationScale,
      ease: "power2.out"
    }, 3.61 * durationScale)
    .to(elements.cardPreview, {
      opacity: 0,
      duration: 0.42 * durationScale,
      ease: "power1.inOut"
    }, 3.74 * durationScale)
    .to(revealTargets, {
      opacity: 1,
      duration: 0.56 * durationScale,
      stagger: 0.025 * durationScale,
      ease: "power1.out"
    }, 4.08 * durationScale)
    .call(finishUnsealing);
}

function promoteCardPreview() {
  const bounds = elements.cardPreview.getBoundingClientRect();
  elements.app.append(elements.cardPreview);
  elements.cardPreview.classList.add("is-extracting");
  window.gsap.set(elements.cardPreview, { clearProps: "transform" });
  window.gsap.set(elements.cardPreview, {
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
  elements.cardPreview.remove();
}

function prepareBookStage() {
  document.body.classList.add("book-open");
  elements.bookStage.hidden = false;
  elements.bookStage.setAttribute("aria-hidden", "true");
  initializeFlipbook();
}

function completeUnsealingWithoutAnimation() {
  document.body.classList.add("book-open");
  elements.envelopeScene.hidden = true;
  elements.bookStage.hidden = false;
  elements.bookStage.style.opacity = "1";
  elements.bookShell.style.transform = "scale(1) translateY(0)";
  initializeFlipbook();
}

function initializeFlipbook() {
  if (pageFlip || elements.bookContainer.classList.contains("is-static-fallback")) return;

  if (!window.St?.PageFlip) {
    initializeStaticFallback();
    return;
  }

  const dimensions = calculatePageDimensions();
  pageFlip = new window.St.PageFlip(elements.bookContainer, {
    width: dimensions.width,
    height: dimensions.height,
    size: "stretch",
    minWidth: 280,
    maxWidth: 550,
    minHeight: 420,
    maxHeight: 900,
    maxShadowOpacity: 0.38,
    showCover: false,
    mobileScrollSupport: false,
    usePortrait: true,
    drawShadow: true,
    flippingTime: 980,
    autoSize: true,
    clickEventForward: true,
    disableFlipByClick: true,
    useMouseEvents: true,
    showPageCorners: true,
    swipeDistance: 22
  });

  pageFlip.loadFromHTML(elements.bookContainer.querySelectorAll(".page-container"));
  pageFlip.on("flip", () => updatePageStatus());
  pageFlip.on("changeOrientation", () => updatePageStatus());
  updatePageStatus();
}

function calculatePageDimensions() {
  const portrait = window.innerWidth < 720 || window.innerHeight > window.innerWidth;
  if (portrait) {
    return {
      width: Math.round(clamp(window.innerWidth, 280, 550)),
      height: Math.round(clamp(window.innerHeight, 420, 900))
    };
  }
  const widthBudget = portrait ? window.innerWidth * 0.92 : window.innerWidth * 0.44;
  const heightBudget = window.innerHeight * 0.76;
  const width = clamp(Math.min(widthBudget, heightBudget * 0.68), 280, 550);
  const height = clamp(Math.min(heightBudget, width / 0.68), 420, 800);
  return { width: Math.round(width), height: Math.round(height) };
}

function initializeStaticFallback() {
  elements.bookContainer.classList.add("is-static-fallback");
  fallbackPageIndex = 0;
  showStaticPage(fallbackPageIndex);
}

function showStaticPage(index) {
  const pages = [...elements.bookContainer.querySelectorAll(".page-container")];
  fallbackPageIndex = clamp(index, 0, pages.length - 1);
  pages.forEach((page, pageIndex) => page.classList.toggle("is-active", pageIndex === fallbackPageIndex));
  updatePageStatus();
}

function turnPage(direction) {
  if (pageFlip) {
    const settings = pageFlip.getSettings();
    const clickGuard = settings.disableFlipByClick;
    settings.disableFlipByClick = false;
    if (direction > 0) pageFlip.flipNext("top");
    else pageFlip.flipPrev("top");
    settings.disableFlipByClick = clickGuard;
    return;
  }
  showStaticPage(fallbackPageIndex + direction);
}

function updatePageStatus() {
  const total = INVITATION_CONFIG.pages.length;
  const currentIndex = pageFlip ? pageFlip.getCurrentPageIndex() : fallbackPageIndex;
  const current = clamp(currentIndex + 1, 1, total);
  elements.pageStatus.textContent = INVITATION_CONFIG.ui.pageStatusTemplate
    .replace("{current}", String(current))
    .replace("{total}", String(total));
  elements.previousPage.disabled = current <= 1;
  elements.nextPage.disabled = current >= total;
}

function bindTapNavigation() {
  let pointerStart = null;

  const interceptMobileTap = (clientX, clientY, target, event) => {
    if (!window.matchMedia("(max-width: 719px)").matches || !pointerStart || isInteractiveTarget(target)) {
      return false;
    }

    const movement = Math.hypot(clientX - pointerStart.x, clientY - pointerStart.y);
    const elapsed = performance.now() - pointerStart.time;
    if (movement > 10 || elapsed > 420) return false;

    pointerStart = null;
    if (event.cancelable) event.preventDefault();
    event.stopImmediatePropagation();
    if (pageFlip && typeof pageFlip.userStop === "function") {
      pageFlip.userStop({ x: 0, y: 0 }, true);
    }
    const bounds = elements.bookContainer.getBoundingClientRect();
    const direction = clientX < bounds.left + bounds.width / 2 ? -1 : 1;
    turnPage(direction);
    return true;
  };

  elements.bookContainer.addEventListener("pointerdown", (event) => {
    pointerStart = {
      x: event.clientX,
      y: event.clientY,
      time: performance.now()
    };
  }, { passive: true });

  window.addEventListener("mouseup", (event) => {
    interceptMobileTap(event.clientX, event.clientY, event.target, event);
  }, true);

  window.addEventListener("touchend", (event) => {
    const touch = event.changedTouches[0];
    if (touch) interceptMobileTap(touch.clientX, touch.clientY, event.target, event);
  }, { capture: true, passive: false });

  elements.bookContainer.addEventListener("pointerup", (event) => {
    if (window.matchMedia("(max-width: 719px)").matches) {
      return;
    }

    if (!pointerStart || isInteractiveTarget(event.target)) {
      pointerStart = null;
      return;
    }

    const movement = Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y);
    const elapsed = performance.now() - pointerStart.time;
    pointerStart = null;
    if (movement > 10 || elapsed > 420) return;

    const bounds = elements.bookContainer.getBoundingClientRect();
    const horizontalPosition = (event.clientX - bounds.left) / bounds.width;
    const verticalPosition = (event.clientY - bounds.top) / bounds.height;
    const isNativeCorner = (horizontalPosition <= 0.35 || horizontalPosition >= 0.65)
      && (verticalPosition <= 0.24 || verticalPosition >= 0.76);
    if (isNativeCorner) return;

    if (horizontalPosition <= 0.4) turnPage(-1);
    else if (horizontalPosition >= 0.6) turnPage(1);
  }, { passive: true });

  elements.bookContainer.addEventListener("pointercancel", () => {
    pointerStart = null;
  }, { passive: true });
}

function isInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest("a, button, input, select, textarea"));
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
    const start = parseEventDateTime(event.date, event.time);
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

function parseEventDateTime(dateText, timeText) {
  const dateMatch = dateText.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  const timeMatch = timeText.match(/(\d{1,2}):(\d{2})\s*(AM|PM)/i);
  if (!dateMatch || !timeMatch) return null;

  const months = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december"
  ];
  const month = months.indexOf(dateMatch[2].toLowerCase());
  if (month < 0) return null;

  let hour = Number(timeMatch[1]) % 12;
  if (timeMatch[3].toUpperCase() === "PM") hour += 12;
  return new Date(Number(dateMatch[3]), month, Number(dateMatch[1]), hour, Number(timeMatch[2]));
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

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}