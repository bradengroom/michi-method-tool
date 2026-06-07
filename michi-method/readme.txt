=== Michi Method Printer ===
Contributors: michimethod
Tags: pokemon, binder, print, image, cards
Requires at least: 5.8
Tested up to: 6.5
Requires PHP: 7.2
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Slice an image into Pokemon-card-sized tiles for binder slots and print them at exact physical size (the "michi method").

== Description ==

The Michi Method Printer embeds a small browser tool on your site. A visitor
uploads any image, picks how many binder slots to span (for example 3 x 3),
and prints. The image is sliced into card-sized tiles so each piece drops into
a binder pocket and the full picture reassembles across the slots.

Features:

* Set the grid with simple columns x rows steppers on the grid edges.
* Card size in millimeters (defaults to a 63x88mm Pokemon card). Enter a
  slightly larger size to fill a sleeve or VaultX binder pocket more snugly.
* Span pockets without cutting: merge any rectangular group of pockets into a
  single uncut piece (for the fold-the-page trick). A pocket seam gap setting
  keeps the art continuous across the hidden divider between windows.
* Starts at true size: the image is placed at 100% of its real size on the
  grid (no upscaling by default). Zoom in or out as needed; a quality badge
  warns if you enlarge it far enough to look pixelated.
* Drag-to-reposition: drag the image in the preview to choose exactly what
  shows in each slot.
* Cut lines in any color, or toggled off entirely.
* Live per-card preview: see each print tile with its cut line.
* Prints at exact physical size via your browser's print dialog.

Privacy: all image processing happens in the visitor's browser. No image is
ever uploaded to your server.

== Installation ==

1. In WordPress go to Plugins > Add New > Upload Plugin.
2. Choose the michi-method.zip file and click Install Now, then Activate.
3. Edit any page or post and either:
   * add the shortcode `[michi_method]`, or
   * insert the "Michi Method Printer" block.
4. Publish. Visitors can now use the tool on that page.

Optional shortcode attributes:

`[michi_method cols="3" rows="3" card_width="63" card_height="88" mark_color="black"]`

== Frequently Asked Questions ==

= The printed cards are the wrong size =

In the browser print dialog set Scale to 100% (or "Actual size") and turn OFF
"Fit to page". This is the most common cause of mis-sized prints.

= Where do the images go? =

Nowhere. Everything is processed in the visitor's browser using the canvas
API. No upload happens.

== Changelog ==

= 1.1.0 =
* Add spanning: merge adjacent pockets into one uncut piece, with separate
  vertical and horizontal pocket seam gaps so the art stays continuous across
  the divider.
* Add "None" option for cut line color.
* Standardize sizes on millimeters.

= 1.0.0 =
* Initial release.
