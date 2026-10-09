# Wedding Invitation

A mobile-first, config-driven wedding invitation with a full-screen video introduction and vertically scrolling sections on a repeating paper texture.

## Video introduction

`assets.introVideo.mobile` and `assets.introVideo.desktop` in `config.json` select the device-specific videos (currently `assets/intro-vid-portrait.mp4` and `assets/intro-vid-landscape.mp4`). Use browser-compatible MP4s, such as H.264 video with AAC audio. The app selects and downloads only one video at startup: screens narrower than 720px or devices with a coarse primary pointer use the mobile file; other devices use the desktop file. The choice stays fixed during playback so resizing or rotating the device does not restart the intro.

A maroon-and-gold loader stays on screen until the entire video has downloaded into a local blob and is ready to play. Guests then tap anywhere (or use Enter/Space on the full-screen play button) to begin. Playback is inline, without native video controls, and keeps the video's original audio. If the device pauses playback, tapping again resumes it. A rejected playback request shows a retry prompt; download or decoding errors show the invitation's error message rather than skipping the intro.

On mobile devices, the selected video rotates 90 degrees clockwise and fills the viewport, cropping as needed. Desktop video fills the viewport without a CSS transform. When playback ends, the video gently crossfades into the invitation over 900 ms. Reduced-motion guests still tap to play the video, but the final transition is immediate. The downloaded video is released after the intro.

The loader, tap prompt, accessible labels, and playback retry text are configurable in `ui`.

## Edit the invitation

Edit `config.json` to change names, copy, dates, events, venue details, contact links, colors, fonts, motifs, or asset paths. The existing `pages` array generates the scrolling sections in order. The HTML and CSS do not need to change when pages are reordered or duplicated.

Change only the top-level `weddingDate` to move the wedding and its related events. It is an ISO date and ceremony time with seconds and an explicit timezone, for example `2026-11-22T18:15:00+05:30` (6:15 PM in India). The cover date, countdown label and deadline, itinerary dates, ceremony time, and calendar export are derived from this value, using the wedding's timezone rather than the guest's device timezone.

Itinerary events use `dayOffset`: `-1` is the day before the wedding, `0` is the wedding day, and `1` is the following day. Other event times remain individually configurable; `useWeddingTime: true` uses the ceremony time from `weddingDate`, with an optional `timeNote`.

The countdown updates at runtime, rolls changing digits, respects reduced motion, and stops at zero. Its labels and completion message are also configurable. Array order, not `pageNumber`, determines section order.

`assets.ganeshaEmblem` sets the cover illustration. The cover's `content.emblemAlt` sets its accessible description.

`assets.sharedPaperTexture` controls the repeating invitation paper. On narrow or touch screens, `assets.mobilePaperTexture` uses a smaller version; leave it empty to use the shared image everywhere. Replace the shared file in place or change its path to update non-touch desktop; set it to an empty string to use the `paperTexture` fallback path.

The configured image files are optional. If they are absent, the invitation uses built-in CSS paper and foil textures. The intro video is required.

## Run locally

Because the app loads `config.json` with `fetch`, serve the folder over HTTP:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

The selected web fonts load from Google Fonts and require a network connection; system fonts are used if they are unavailable. No animation or page-flip library is required.

## Validate changes

Check JavaScript syntax and run the intro's regression tests with Node.js (no dependencies required):

```sh
node --check app.js
node --test tests/intro.test.cjs
```

Also test the actual MP4 in a browser at portrait mobile and landscape sizes, including loading, tap-to-play, and the final fade.