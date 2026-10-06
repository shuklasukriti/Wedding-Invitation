# Wedding Invitation

A mobile-first, config-driven wedding invitation with a GSAP envelope reveal and vertically scrolling sections on a repeating paper texture.

## Edit the invitation

Edit `config.json` to change names, copy, dates, events, venue details, contact links, colors, fonts, motifs, or asset paths. The existing `pages` array generates the scrolling sections in order. The HTML and CSS do not need to change when pages are reordered or duplicated.

Change only the top-level `weddingDate` to move the wedding and its related events. It is an ISO date and ceremony time with seconds and an explicit timezone, for example `2026-11-22T18:15:00+05:30` (6:15 PM in India). The cover date, countdown label and deadline, itinerary dates, ceremony time, and calendar export are derived from this value, using the wedding's timezone rather than the guest's device timezone.

Itinerary events use `dayOffset`: `-1` is the day before the wedding, `0` is the wedding day, and `1` is the following day. Other event times remain individually configurable; `useWeddingTime: true` uses the ceremony time from `weddingDate`, with an optional `timeNote`.

The countdown updates at runtime, rolls changing digits, respects reduced motion, and stops at zero. Its labels and completion message are also configurable. Array order, not `pageNumber`, determines section order.

`assets.ganeshaEmblem` sets the cover illustration. The cover's `content.emblemAlt` sets its accessible description.

`assets.sharedPaperTexture` controls both the envelope and the repeating invitation paper. On narrow or touch screens, `assets.mobilePaperTexture` uses a smaller version for smoother animations; leave it empty to use the shared image everywhere. Replace the shared file in place or change its path to update non-touch desktop; set it to an empty string only when you want the separate `envelopeOuter` and `paperTexture` fallback paths.

The configured image files are optional. If they are absent, the invitation uses built-in CSS paper, wood, foil, and wax textures.

## Run locally

Because the app loads `config.json` with `fetch`, serve the folder over HTTP:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

The GSAP browser bundle and selected web fonts load from CDNs and require a network connection. If GSAP is unavailable, the envelope opens immediately and all invitation sections remain readable by scrolling. No page-flip library is required.