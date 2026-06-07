# Michi Method Printer

A WordPress plugin that embeds a browser-based tool to slice an image into
Pokemon-card-sized tiles across a binder-slot grid and print them at exact
physical size (the "michi method").

All image processing runs client-side in the browser. There are **no
dependencies and no build step** - just plain JavaScript, CSS, and PHP.

## What's in here

```
michi-method/
  michi-method.php        Main plugin file (shortcode + block registration, asset enqueue)
  assets/
    css/michi.css         UI styles + print rules (@page, @media print)
    js/michi.js           The whole tool (upload, controls, slicing, print)
  blocks/
    block.json            Gutenberg block definition (server-rendered)
    index.js              Block editor UI (uses wp.* globals, no build)
    index.asset.php       Editor script dependency manifest
  dev/
    index.html            Standalone test harness (NOT shipped to users)
  readme.txt              WordPress.org-style plugin readme
  README.md               This file
```

## Local development (no WordPress needed)

The core (`assets/js/michi.js` + `assets/css/michi.css`) is WordPress-agnostic.
It bootstraps off a `<div id="michi-method-app">` container and reads its
defaults from `data-*` attributes. `dev/index.html` reproduces that container so
you can run the entire tool standalone.

From the `michi-method/` folder:

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000/dev/>. Edit the files under `assets/` and
refresh. To verify print output, use your browser's Print preview (set scale to
100% / Actual size).

Because the harness loads the exact same `assets/` files the plugin enqueues,
anything that works here works identically inside WordPress.

## Packaging for distribution

Ship the `michi-method/` folder as a zip, excluding the dev harness:

```bash
# Run from the parent directory that contains michi-method/
zip -r michi-method.zip michi-method \
  -x "michi-method/dev/*" \
  -x "*/.DS_Store"
```

Install in WordPress via **Plugins > Add New > Upload Plugin**, then activate.

## Usage

Add to any page/post:

- Shortcode: `[michi_method]`
- Or insert the **Michi Method Printer** block.

Shortcode attributes (all optional): `cols`, `rows`, `card_width`,
`card_height`, `vgap`, `hgap`, `mark_color`, `units`.
Example:

```
[michi_method cols="3" rows="4" card_width="63" card_height="88" mark_color="black"]
```

### Spanning pockets (uncut pieces)

For art that crosses two or more pockets without cutting (fold the binder page
and slide one longer piece across the pockets), set the **Pocket seam gap** to
the width of the divider between your pocket windows, click **Select pockets**,
drag across the pockets in the preview, then **Merge into one piece**. That
block prints as a single uncut tile; the seam-gap strip is printed but hides
behind the divider so the art stays continuous across the windows. Use
**Split** or **Clear all spans** to undo.

## Customizing the look

The UI is styled with CSS custom properties on `.michi-method`, so it can be
retheme from WordPress **Appearance > Customize > Additional CSS** (block
themes: **Site Editor > Styles > Additional CSS**) without editing plugin
files. The shipped defaults are a dark palette tuned to match a dark site.

```css
.michi-method {
  --mm-bg: #ffffff;        /* the tool's card background */
  --mm-text: #111827;
  --mm-label: #374151;
  --mm-muted: #6b7280;
  --mm-surface: #ffffff;   /* inputs, buttons */
  --mm-surface-alt: #f3f4f6;
  --mm-dropzone-bg: #fafbfc;
  --mm-border: #d8dbe0;
  --mm-accent: #2563eb;    /* highlights, primary button */
  --mm-radius: 8px;        /* control corner radius */
  --mm-radius-lg: 12px;    /* panel/card radius */
  --mm-font: "Inter", system-ui, sans-serif;
  --mm-max-width: 760px;
}
```

`--mm-paper` (white) is intentionally kept separate from the chrome colors so
the image preview and printed output stay correct regardless of theme.

## Printing tip

In the browser print dialog, set **Scale to 100% / Actual size** and turn off
**Fit to page**. Otherwise the cards will not match your binder pockets.
