"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const { test } = require("node:test");
const vm = require("node:vm");

const source = readFileSync(join(__dirname, "../app.js"), "utf8");
const config = JSON.parse(readFileSync(join(__dirname, "../config.json"), "utf8"));
const flush = () => new Promise(resolve => setImmediate(resolve));

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function createHarness({ reducedMotion = false, mobile = false } = {}) {
  const nodes = new Map();
  const errors = [];
  const createdUrls = [];
  const revokedUrls = [];
  const bodyClasses = new Set(["intro-active"]);
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, new Element(id));
      return nodes.get(id);
    },
    body: {
      classList: {
        add: (...names) => names.forEach(name => bodyClasses.add(name)),
        remove: (...names) => names.forEach(name => bodyClasses.delete(name))
      }
    },
    querySelector: () => null
  };

  class Element extends EventTarget {
    constructor(id) {
      super();
      this.id = id;
      this.hidden = false;
      this.disabled = false;
      this.inert = false;
      this.attributes = new Map();
      const classes = new Set();
      this.classList = {
        toggle(name, enabled) {
          if (enabled) classes.add(name);
          else classes.delete(name);
          return enabled;
        },
        contains: name => classes.has(name)
      };
      this.animations = [];
      this.loadCount = 0;
      this.playCount = 0;
      this.ended = false;
    }
    set src(value) { this.setAttribute("src", value); }
    get src() { return this.getAttribute("src") || ""; }
    setAttribute(name, value) { this.attributes.set(name, value); }
    getAttribute(name) { return this.attributes.get(name) ?? null; }
    removeAttribute(name) { this.attributes.delete(name); }
    load() { this.loadCount++; }
    play() { this.playCount++; return Promise.resolve(); }
    focus() { document.activeElement = this; }
    animate(keyframes, timing) {
      const animation = new EventTarget();
      animation.keyframes = keyframes;
      animation.timing = timing;
      this.animations.push(animation);
      return animation;
    }
  }

  const context = vm.createContext({
    document,
    window: { matchMedia: query => ({ matches: query.includes("reduced-motion") ? reducedMotion : mobile }) },
    // Hold automatic boot at its first request; tests exercise the intro functions directly.
    fetch: () => new Promise(() => {}),
    console: { error: (...args) => errors.push(args) },
    URL: {
      createObjectURL(blob) { createdUrls.push(blob); return "blob:intro-test"; },
      revokeObjectURL(url) { revokedUrls.push(url); }
    }
  });
  vm.runInContext(source, context);
  vm.runInContext(`INVITATION_CONFIG = ${JSON.stringify(config)};`, context);
  const evaluate = code => vm.runInContext(code, context);
  const video = document.getElementById("intro-video");
  const scene = document.getElementById("intro-scene");
  const play = document.getElementById("intro-play");
  const stage = document.getElementById("book-stage");
  const prompt = document.getElementById("intro-prompt");
  stage.hidden = true;
  stage.inert = true;
  stage.setAttribute("aria-hidden", "true");
  context.populateInterface(config);

  return { context, evaluate, document, video, scene, play, stage, prompt, errors, createdUrls, revokedUrls, bodyClasses };
}

test("the complete download and decoder readiness both gate the intro", async () => {
  const h = createHarness();
  const download = deferred();
  h.context.fetch = async () => ({ ok: true, blob: () => download.promise });
  let ready = false;
  const loading = h.context.loadIntroVideo(config.assets.introVideo).then(() => { ready = true; });

  await flush();
  assert.equal(h.createdUrls.length, 0);
  assert.equal(h.video.loadCount, 0);
  assert.equal(ready, false);

  download.resolve({ size: 1024 });
  await flush();
  assert.equal(h.createdUrls.length, 1);
  assert.equal(h.video.src, "blob:intro-test");
  assert.equal(h.video.loadCount, 1);
  assert.equal(ready, false);

  h.video.dispatchEvent(new Event("canplay"));
  await loading;
  assert.equal(ready, true);
});

test("only the device-specific video downloads, and only mobile gets rotation", async () => {
  for (const mobile of [true, false]) {
    const h = createHarness({ mobile });
    const paths = [];
    h.context.fetch = async path => {
      paths.push(path);
      return { ok: true, blob: async () => ({ size: 1024 }) };
    };
    const loading = h.context.loadIntroVideo(config.assets.introVideo);
    await flush();
    h.video.dispatchEvent(new Event("canplay"));
    await loading;
    assert.deepEqual(paths, [config.assets.introVideo[mobile ? "mobile" : "desktop"]]);
    assert.equal(h.video.classList.contains("is-mobile"), mobile);
  }
});

test("failed requests, empty files, and decoding errors are rejected", async t => {
  await t.test("HTTP failure", async () => {
    const h = createHarness();
    h.context.fetch = async () => ({ ok: false, status: 404 });
    await assert.rejects(h.context.loadIntroVideo(config.assets.introVideo), /status 404/);
    assert.equal(h.createdUrls.length, 0);
  });
  await t.test("empty download", async () => {
    const h = createHarness();
    h.context.fetch = async () => ({ ok: true, blob: async () => ({ size: 0 }) });
    await assert.rejects(h.context.loadIntroVideo(config.assets.introVideo), /file is empty/);
    assert.equal(h.createdUrls.length, 0);
  });
  await t.test("unsupported media", async () => {
    const h = createHarness();
    h.context.fetch = async () => ({ ok: true, blob: async () => ({ size: 1024 }) });
    const loading = h.context.loadIntroVideo(config.assets.introVideo);
    const rejection = assert.rejects(loading, /could not be decoded.*4/);
    await flush();
    h.video.error = { code: 4 };
    h.video.dispatchEvent(new Event("error"));
    await rejection;
    h.context.showLoadError(config.ui);
    assert.deepEqual(h.revokedUrls, ["blob:intro-test"]);
    assert.equal(h.stage.hidden, true);
    assert.equal(h.document.getElementById("error-state").hidden, false);
  });
});

test("loading ignores taps and rapid ready-state taps start playback only once", async () => {
  const h = createHarness();
  await h.context.playIntro();
  assert.equal(h.video.playCount, 0);

  h.evaluate('introState = "ready";');
  const starting = deferred();
  h.video.play = () => { h.video.playCount++; return starting.promise; };
  const firstTap = h.context.playIntro();
  await h.context.playIntro();
  assert.equal(h.video.playCount, 1);
  assert.equal(h.play.hidden, true);
  assert.equal(h.stage.hidden, true);
  starting.resolve();
  await firstTap;
  assert.equal(h.evaluate("introState"), "playing");
});

test("playback rejection logs a retry message and leaves the intro playable", async () => {
  const h = createHarness();
  h.evaluate('introState = "ready";');
  h.video.play = () => Promise.reject(new Error("Playback denied"));
  await h.context.playIntro();
  assert.equal(h.evaluate("introState"), "ready");
  assert.equal(h.prompt.textContent, config.ui.introPlaybackErrorText);
  assert.equal(h.play.hidden, false);
  assert.equal(h.document.activeElement, h.play);
  assert.equal(h.errors.length, 1);
  assert.equal(h.stage.hidden, true);

  h.video.play = () => Promise.resolve();
  await h.context.playIntro();
  assert.equal(h.evaluate("introState"), "playing");
});

test("a device pause allows resuming without resetting playback", async () => {
  const h = createHarness();
  h.context.bindIntroEvents();
  h.evaluate('introState = "ready";');
  await h.context.playIntro();
  h.video.currentTime = 3;
  h.video.dispatchEvent(new Event("pause"));
  assert.equal(h.evaluate("introState"), "ready");
  assert.equal(h.play.hidden, false);
  await h.context.playIntro();
  assert.equal(h.video.currentTime, 3);
  assert.equal(h.evaluate("introState"), "playing");
});

test("ended playback holds the final frame, slowly reveals opaque paper, then starts content entry", async () => {
  const h = createHarness();
  h.context.bindIntroEvents();
  h.evaluate('introState = "ready"; introVideoUrl = "blob:intro-test";');
  h.video.src = "blob:intro-test";
  await h.context.playIntro();
  assert.equal(h.stage.hidden, true);
  h.video.ended = true;
  h.video.dispatchEvent(new Event("pause"));
  assert.equal(h.evaluate("introState"), "playing");
  h.video.dispatchEvent(new Event("ended"));
  h.video.dispatchEvent(new Event("ended"));

  assert.equal(h.evaluate("introState"), "revealing");
  assert.equal(h.stage.hidden, false);
  assert.equal(h.stage.inert, true);
  assert.equal(h.bodyClasses.has("invitation-ready"), false);
  assert.equal(h.scene.animations.length, 1);
  assert.equal(h.stage.animations.length, 0);
  assert.equal(h.scene.animations[0].timing.delay, config.theme.motion.introFadeDelayMs);
  assert.equal(h.scene.animations[0].timing.duration, config.theme.motion.introFadeDurationMs);
  assert.equal(h.scene.animations[0].timing.fill, "backwards");
  assert.ok(h.scene.animations[0].timing.delay >= 800);
  assert.ok(h.scene.animations[0].timing.duration >= 2600);
  assert.equal(h.scene.animations[0].keyframes[0].opacity, 1);
  h.scene.animations[0].dispatchEvent(new Event("finish"));

  assert.equal(h.evaluate("introState"), "complete");
  assert.equal(h.scene.hidden, true);
  assert.equal(h.stage.inert, false);
  assert.equal(h.stage.getAttribute("aria-hidden"), null);
  assert.equal(h.bodyClasses.has("intro-active"), false);
  assert.equal(h.bodyClasses.has("invitation-ready"), true);
  assert.equal(h.document.activeElement.id, "book-container");
  assert.deepEqual(h.revokedUrls, ["blob:intro-test"]);
  assert.equal(h.video.getAttribute("src"), null);
});

test("reduced motion skips the fade, not user-initiated playback", async () => {
  const h = createHarness({ reducedMotion: true });
  h.context.bindIntroEvents();
  h.evaluate('introState = "ready";');
  assert.equal(h.stage.hidden, true);
  await h.context.playIntro();
  assert.equal(h.stage.hidden, true);
  h.video.ended = true;
  h.video.dispatchEvent(new Event("ended"));
  assert.equal(h.evaluate("introState"), "complete");
  assert.equal(h.scene.animations.length, 0);
  assert.equal(h.stage.inert, false);
  assert.equal(h.bodyClasses.has("invitation-ready"), true);
});

test("motion timings reject missing, negative, non-numeric, and non-finite values", () => {
  const h = createHarness();
  for (const key of Object.keys(config.theme.motion)) {
    for (const value of [undefined, -1, "1000", Infinity, NaN]) {
      const theme = { ...config.theme, motion: { ...config.theme.motion, [key]: value } };
      assert.throws(() => h.context.validateConfig({ ...config, theme }), new RegExp(`theme\\.motion\\.${key}`));
    }
  }
});

test("a playback media error is reported instead of silently revealing content", async () => {
  const h = createHarness();
  h.context.bindIntroEvents();
  h.evaluate('introState = "ready"; introVideoUrl = "blob:intro-test";');
  await h.context.playIntro();
  h.video.error = { code: 3 };
  h.video.dispatchEvent(new Event("error"));
  assert.equal(h.evaluate("introState"), "error");
  assert.equal(h.stage.hidden, true);
  assert.equal(h.scene.hidden, true);
  assert.equal(h.errors.length, 1);
  assert.equal(h.document.getElementById("error-title").textContent, config.ui.loadErrorTitle);
  assert.deepEqual(h.revokedUrls, ["blob:intro-test"]);
});

test("configuration requires both video paths and intro accessibility and status copy", () => {
  const h = createHarness();
  h.context.validateConfig(config);
  for (const device of ["mobile", "desktop"]) {
    const assets = { ...config.assets, introVideo: { ...config.assets.introVideo, [device]: "" } };
    assert.throws(() => h.context.validateConfig({ ...config, assets }), new RegExp(`assets\\.introVideo\\.${device}`));
  }
  for (const key of ["loadingText", "introSceneAriaLabel", "introPlayAriaLabel", "introPromptText", "introPlaybackErrorText"]) {
    assert.throws(() => h.context.validateConfig({ ...config, ui: { ...config.ui, [key]: "" } }), new RegExp(`ui\\.${key}`));
  }
});
