# Wedding Invitation

A mobile-first, config-driven wedding invitation with a GSAP envelope reveal and StPageFlip booklet.

## Edit the invitation

Edit `config.json` to change names, copy, dates, events, venue details, contact links, colors, fonts, motifs, or asset paths. The HTML and CSS do not need to change when pages are reordered or duplicated.

`assets.sharedPaperTexture` controls both the envelope and booklet paper. Replace that file in place or change this single path to update both; set it to an empty string only when you want the separate `envelopeOuter` and `paperTexture` fallback paths.

The configured image files are optional. If they are absent, the invitation uses built-in CSS paper, wood, foil, and wax textures.

## Run locally

Because the app loads `config.json` with `fetch`, serve the folder over HTTP:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`.

The GSAP and StPageFlip browser bundles, plus the selected web fonts, load from CDNs and require a network connection. If either animation library is unavailable, the envelope opens immediately and the booklet remains usable as a static paged view.