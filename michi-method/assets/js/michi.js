/**
 * Michi Method Printer - client-side image slicer.
 *
 * Zero dependencies. Bootstraps off any `.michi-method` container, reads its
 * defaults from data-* attributes, builds the UI, slices an uploaded image into
 * Pokemon-card-sized tiles across a binder-slot grid, and prints them at exact
 * physical size. All work happens in the browser; nothing is uploaded.
 */
(function () {
	'use strict';

	var MM_PER_INCH = 25.4;
	var PRINT_DPI = 300; // Target resolution for the sliced tile canvases.
	var PX_PER_MM = PRINT_DPI / MM_PER_INCH;

	// Common trading-card sizes in millimeters. Several games share the 63x88mm
	// "standard" size; they are listed separately so the common case is obvious.
	var CARD_PRESETS = [
		{ id: 'pokemon', label: 'Pokemon (63 x 88 mm)', w: 63, h: 88 },
		{ id: 'mtg', label: 'Magic: The Gathering (63 x 88 mm)', w: 63, h: 88 },
		{ id: 'onepiece', label: 'One Piece (63 x 88 mm)', w: 63, h: 88 },
		{ id: 'lorcana', label: 'Lorcana (63 x 88 mm)', w: 63, h: 88 },
		{ id: 'yugioh', label: 'Yu-Gi-Oh! (59 x 86 mm)', w: 59, h: 86 },
		{ id: 'custom', label: 'Custom size', w: 0, h: 0 }
	];

	function cardPresetById(id) {
		for (var i = 0; i < CARD_PRESETS.length; i++) {
			if (CARD_PRESETS[i].id === id) {
				return CARD_PRESETS[i];
			}
		}
		return null;
	}

	function detectCardPreset(wmm, hmm) {
		for (var i = 0; i < CARD_PRESETS.length; i++) {
			var p = CARD_PRESETS[i];
			if (p.id !== 'custom' && p.w === wmm && p.h === hmm) {
				return p.id;
			}
		}
		return 'custom';
	}

	function el(tag, attrs, children) {
		var node = document.createElement(tag);
		attrs = attrs || {};
		Object.keys(attrs).forEach(function (key) {
			if (key === 'class') {
				node.className = attrs[key];
			} else if (key === 'text') {
				node.textContent = attrs[key];
			} else if (key === 'html') {
				node.innerHTML = attrs[key];
			} else if (key.indexOf('on') === 0 && typeof attrs[key] === 'function') {
				node.addEventListener(key.slice(2).toLowerCase(), attrs[key]);
			} else {
				node.setAttribute(key, attrs[key]);
			}
		});
		(children || []).forEach(function (child) {
			if (child == null) {
				return;
			}
			node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
		});
		return node;
	}

	function round(value, decimals) {
		var f = Math.pow(10, decimals || 0);
		return Math.round(value * f) / f;
	}

	/**
	 * Where the image sits on the grid, in millimeters. At zoom 1 the image is
	 * shown at its true size: one source pixel maps to one print pixel at
	 * PRINT_DPI, which is the largest size that never upscales. Zoom only goes
	 * below 1, so the print is always at least PRINT_DPI (no pixelation).
	 */
	function placementMm(artWmm, artHmm, imgW, imgH, zoom, offsetXmm, offsetYmm) {
		var dW = (imgW / PX_PER_MM) * zoom;
		var dH = (imgH / PX_PER_MM) * zoom;
		return {
			dW: dW,
			dH: dH,
			dx: (artWmm - dW) / 2 + (offsetXmm || 0),
			dy: (artHmm - dH) / 2 + (offsetYmm || 0)
		};
	}

	function MichiApp(root) {
		this.root = root;
		this.image = null; // HTMLImageElement once loaded.
		this.state = {
			cols: parseInt(root.getAttribute('data-default-cols'), 10) || 3,
			rows: parseInt(root.getAttribute('data-default-rows'), 10) || 1,
			cardWidthMm: parseFloat(root.getAttribute('data-card-width-mm')) || 63,
			cardHeightMm: parseFloat(root.getAttribute('data-card-height-mm')) || 88,
			vGapMm: parseFloat(root.getAttribute('data-vgap-mm')) || 0, // vertical seam (between columns)
			hGapMm: parseFloat(root.getAttribute('data-hgap-mm')) || 0, // horizontal seam (between rows)
			markColor: (function (mc) {
				return mc === 'white' || mc === 'none' ? mc : 'black';
			})(root.getAttribute('data-mark-color')),
			zoom: 1, // 1 = true size; only goes below 1 (never upscales)
			rotation: 0, // image rotation in degrees: 0, 90, 180, 270
			offsetX: 0, // image pan within the grid, in mm (art-area coords)
			offsetY: 0,
			units: 'mm',
			spans: [], // merged pockets: array of {c0,r0,c1,r1} inclusive rectangles
			selectMode: false, // when true, dragging selects pockets instead of panning
			selection: null // committed selection rect {c0,r0,c1,r1} or null
		};
		this.state.cardPreset = detectCardPreset(this.state.cardWidthMm, this.state.cardHeightMm);
		this.build();
		this.refreshControlValues();
		this.renderPreview();
	}

	MichiApp.prototype.markColorHex = function () {
		return this.state.markColor === 'white' ? '#ffffff' : '#000000';
	};

	MichiApp.prototype.marksVisible = function () {
		return this.state.markColor !== 'none';
	};

	MichiApp.prototype.updateZoomLabel = function () {
		if (this.zoomValue) {
			this.zoomValue.textContent = Math.round(this.state.zoom * 100) + '%';
		}
	};

	MichiApp.prototype.toDisplay = function (mm) {
		return this.state.units === 'in' ? round(mm / MM_PER_INCH, 3) : round(mm, 2);
	};

	MichiApp.prototype.fromDisplay = function (value) {
		var n = parseFloat(value);
		if (isNaN(n)) {
			return 0;
		}
		return this.state.units === 'in' ? n * MM_PER_INCH : n;
	};

	MichiApp.prototype.build = function () {
		var self = this;
		this.root.innerHTML = '';

		// ---- Screen-only tool UI ----
		this.tool = el('div', { class: 'mm-tool' });

		// Dropzone / file input.
		this.fileInput = el('input', { type: 'file', accept: 'image/*', class: 'mm-file-input' });
		this.fileInput.addEventListener('change', function (e) {
			if (e.target.files && e.target.files[0]) {
				self.loadFile(e.target.files[0]);
			}
		});

		this.dropzone = el('div', { class: 'mm-dropzone', tabindex: '0', role: 'button' }, [
			el('div', { class: 'mm-dropzone-inner' }, [
				el('strong', { text: 'Drop an image here' }),
				el('span', { text: 'or click to choose a file' }),
				el('small', { text: 'Your image stays on your device.' })
			]),
			this.fileInput
		]);
		this.dropzone.addEventListener('click', function () {
			self.fileInput.click();
		});
		this.dropzone.addEventListener('keydown', function (e) {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				self.fileInput.click();
			}
		});
		['dragenter', 'dragover'].forEach(function (evt) {
			self.dropzone.addEventListener(evt, function (e) {
				e.preventDefault();
				self.dropzone.classList.add('is-dragover');
			});
		});
		['dragleave', 'drop'].forEach(function (evt) {
			self.dropzone.addEventListener(evt, function (e) {
				e.preventDefault();
				self.dropzone.classList.remove('is-dragover');
			});
		});
		this.dropzone.addEventListener('drop', function (e) {
			var dt = e.dataTransfer;
			if (dt && dt.files && dt.files[0]) {
				self.loadFile(dt.files[0]);
			}
		});

		// The dropzone and the preview share one box (appended together below):
		// the dropzone is the empty state, the grid takes over once an image loads.

		// Zoom control, kept next to the preview so it sits right by the image.
		this.zoomInput = el('input', { type: 'range', min: '10', max: '400', step: '1', class: 'mm-range' });
		this.zoomValue = el('span', { class: 'mm-range-value' });
		this.zoomInput.addEventListener('input', function () {
			var pct = parseInt(self.zoomInput.value, 10) || 100;
			self.state.zoom = Math.max(0.1, Math.min(4, pct / 100));
			self.updateZoomLabel();
			self.renderPreview();
		});
		var zoomBar = el('div', { class: 'mm-zoom-bar' }, [
			el('span', { class: 'mm-label', text: 'Zoom (100% = true size)' }),
			el('div', { class: 'mm-inline' }, [this.zoomInput, this.zoomValue])
		]);

		// Preview.
		this.previewCanvas = el('canvas', { class: 'mm-preview-canvas' });

		// Edge steppers: add/remove a column (right edge) or row (bottom edge),
		// right next to the grid. They stay in sync with the top number inputs.
		this.colStepValue = el('span', { class: 'mm-step-value' });
		this.rowStepValue = el('span', { class: 'mm-step-value' });
		this.colStepper = el('div', { class: 'mm-stepper mm-stepper--cols' }, [
			el('span', { class: 'mm-step-label', text: 'Cols' }),
			el('button', { type: 'button', class: 'mm-step-btn', text: '+', title: 'Add column', onClick: function () { self.nudgeGrid(1, 0); } }),
			this.colStepValue,
			el('button', { type: 'button', class: 'mm-step-btn', text: '\u2212', title: 'Remove column', onClick: function () { self.nudgeGrid(-1, 0); } })
		]);
		this.rowStepper = el('div', { class: 'mm-stepper mm-stepper--rows' }, [
			el('span', { class: 'mm-step-label', text: 'Rows' }),
			el('button', { type: 'button', class: 'mm-step-btn', text: '\u2212', title: 'Remove row', onClick: function () { self.nudgeGrid(0, -1); } }),
			this.rowStepValue,
			el('button', { type: 'button', class: 'mm-step-btn', text: '+', title: 'Add row', onClick: function () { self.nudgeGrid(0, 1); } })
		]);
		this.gridStage = el('div', { class: 'mm-grid-stage' }, [
			this.previewCanvas,
			this.colStepper,
			this.rowStepper
		]);

		this.previewHint = el('div', { class: 'mm-preview-hint', text: 'Drag the image to reposition it within the grid.' });

		// "Change image" lives in the corner of the preview box (only with an image).
		this.changeButton = el('button', {
			type: 'button',
			class: 'mm-change-btn mm-when-image',
			text: 'Change image',
			onClick: function () {
				self.fileInput.click();
			}
		});

		// Rotate controls in the opposite corner of the preview box.
		this.rotateBar = el('div', { class: 'mm-rotate-bar' }, [
			el('button', { type: 'button', class: 'mm-rotate-btn', text: '\u21BA', title: 'Rotate left', onClick: function () { self.rotate(-1); } }),
			el('button', { type: 'button', class: 'mm-rotate-btn', text: '\u21BB', title: 'Rotate right', onClick: function () { self.rotate(1); } })
		]);

		this.previewWrap = el('div', { class: 'mm-preview' }, [
			this.dropzone,
			this.changeButton,
			this.rotateBar,
			zoomBar,
			this.gridStage,
			this.previewHint
		]);

		// Controls first, then the combined upload/preview box below them.
		this.tool.appendChild(this.buildControls());
		this.tool.appendChild(this.previewWrap);
		this.attachDrag();

		// Resolution / print-quality badge.
		this.qualityEl = el('div', { class: 'mm-quality', style: 'display:none;' });
		this.tool.appendChild(this.qualityEl);

		// Actions + tips.
		this.printButton = el('button', {
			type: 'button',
			class: 'mm-print-btn',
			text: 'Print tiles',
			disabled: 'disabled',
			onClick: function () {
				self.print();
			}
		});
		this.tool.appendChild(el('div', { class: 'mm-actions' }, [this.printButton]));

		this.tool.appendChild(
			el('div', { class: 'mm-tips' }, [
				el('strong', { text: 'Before printing: ' }),
				el('span', {
					text:
						'In your browser print dialog set Scale to 100% (or "Actual size") and turn OFF "Fit to page". ' +
						'Otherwise the cards will not be the right size for your binder.'
				})
			])
		);

		this.root.appendChild(this.tool);

		// ---- Print-only output ----
		this.printRoot = el('div', { class: 'mm-print-root' });
		this.root.appendChild(this.printRoot);
	};

	MichiApp.prototype.buildControls = function () {
		var self = this;
		var controls = el('div', { class: 'mm-controls' });

		// Grid columns/rows are set with the +/- steppers on the grid edges.

		// Card type preset (sets the per-slot size).
		this.cardPresetSelect = el(
			'select',
			{ class: 'mm-select' },
			CARD_PRESETS.map(function (p) {
				return el('option', { value: p.id, text: p.label });
			})
		);
		this.cardPresetSelect.addEventListener('change', function () {
			var id = self.cardPresetSelect.value;
			self.state.cardPreset = id;
			var preset = cardPresetById(id);
			if (preset && id !== 'custom') {
				self.state.cardWidthMm = preset.w;
				self.state.cardHeightMm = preset.h;
			}
			self.refreshControlValues();
			self.renderPreview();
		});
		controls.appendChild(this.field('Card type', this.cardPresetSelect));

		// Custom size inputs, shown only when "Custom size" is chosen.
		this.cardWInput = el('input', { type: 'number', step: 'any', min: '1', class: 'mm-num' });
		this.cardHInput = el('input', { type: 'number', step: 'any', min: '1', class: 'mm-num' });
		this.cardWInput.addEventListener('input', function () {
			self.state.cardWidthMm = self.fromDisplay(self.cardWInput.value);
			self.renderPreview();
		});
		this.cardHInput.addEventListener('input', function () {
			self.state.cardHeightMm = self.fromDisplay(self.cardHInput.value);
			self.renderPreview();
		});
		this.customSizeField = this.field(
			'Custom card size (mm)',
			el('div', { class: 'mm-inline' }, [
				this.cardWInput,
				el('span', { class: 'mm-x', text: 'x' }),
				this.cardHInput
			])
		);
		controls.appendChild(this.customSizeField);

		// Seam gaps: the dead strip between pocket windows. Used so a piece that
		// spans multiple pockets stays visually continuous across the divider.
		this.vGapInput = el('input', { type: 'number', step: 'any', min: '0', class: 'mm-num' });
		this.hGapInput = el('input', { type: 'number', step: 'any', min: '0', class: 'mm-num' });
		this.vGapInput.addEventListener('input', function () {
			self.state.vGapMm = Math.max(0, self.fromDisplay(self.vGapInput.value));
			self.renderPreview();
		});
		this.hGapInput.addEventListener('input', function () {
			self.state.hGapMm = Math.max(0, self.fromDisplay(self.hGapInput.value));
			self.renderPreview();
		});
		controls.appendChild(
			this.field(
				'Pocket seam gap (mm): vertical x horizontal',
				el('div', { class: 'mm-inline' }, [
					this.vGapInput,
					el('span', { class: 'mm-x', text: 'x' }),
					this.hGapInput
				])
			)
		);

		// Spanning: merge adjacent pockets into one uncut piece.
		this.selectToggle = el('button', {
			type: 'button',
			class: 'mm-span-btn',
			text: 'Select pockets',
			onClick: function () {
				self.setSelectMode(!self.state.selectMode);
			}
		});
		this.mergeButton = el('button', {
			type: 'button',
			class: 'mm-span-btn',
			text: 'Merge into one piece',
			onClick: function () {
				self.mergeSelection();
			}
		});
		this.splitButton = el('button', {
			type: 'button',
			class: 'mm-span-btn',
			text: 'Split',
			onClick: function () {
				self.splitSelection();
			}
		});
		this.clearSpansButton = el('button', {
			type: 'button',
			class: 'mm-span-btn',
			text: 'Clear all spans',
			onClick: function () {
				self.clearSpans();
				self.renderPreview();
			}
		});
		this.spanHint = el('div', { class: 'mm-span-hint' });
		var spanField = this.field(
			'Span pockets (uncut)',
			el('div', { class: 'mm-span-controls' }, [
				this.selectToggle,
				this.mergeButton,
				this.splitButton,
				this.clearSpansButton,
				this.spanHint
			])
		);
		spanField.classList.add('mm-field--wide');
		controls.appendChild(spanField);

		// Mark / cut-line color.
		this.markColorSelect = el('select', { class: 'mm-select' }, [
			el('option', { value: 'black', text: 'Black' }),
			el('option', { value: 'white', text: 'White' }),
			el('option', { value: 'none', text: 'None' })
		]);
		this.markColorSelect.addEventListener('change', function () {
			self.state.markColor = self.markColorSelect.value;
			self.renderPreview();
		});
		controls.appendChild(this.field('Cut line color', this.markColorSelect));

		return controls;
	};

	MichiApp.prototype.field = function (label, control) {
		var children = [];
		if (label) {
			children.push(el('span', { class: 'mm-label', text: label }));
		}
		children.push(control);
		return el('label', { class: 'mm-field' }, children);
	};

	/**
	 * Pick a sensible default grid from the image's true (100%) print size:
	 * how many cards it naturally covers at PRINT_DPI, capped at 3x3. The user
	 * can expand beyond that with the steppers. Clears any spans.
	 */
	MichiApp.prototype.applyDefaultGrid = function () {
		if (!this.image) {
			return;
		}
		var s = this.state;
		var physWmm = this.image.width / PX_PER_MM;
		var physHmm = this.image.height / PX_PER_MM;
		var cols = Math.round(physWmm / s.cardWidthMm);
		var rows = Math.round(physHmm / s.cardHeightMm);
		s.cols = Math.max(1, Math.min(3, cols || 1));
		s.rows = Math.max(1, Math.min(3, rows || 1));
		this.clearSpans();
	};

	/**
	 * Rotate the image 90 degrees. dir = 1 (clockwise) or -1 (counter-clockwise).
	 * We render a rotated copy into a canvas and use it as `this.image`, so the
	 * rest of the pipeline (which reads width/height and draws it) is unchanged.
	 */
	MichiApp.prototype.rotate = function (dir) {
		if (!this.sourceImage) {
			return;
		}
		this.state.rotation = (this.state.rotation + dir * 90 + 360) % 360;
		this.image = this.buildRotatedImage();
		this.state.offsetX = 0;
		this.state.offsetY = 0;
		this.renderPreview();
	};

	/** Build a rotated copy of the source image for the current rotation. */
	MichiApp.prototype.buildRotatedImage = function () {
		var src = this.sourceImage;
		var deg = this.state.rotation;
		if (!src) {
			return null;
		}
		if (deg === 0) {
			return src;
		}
		var w = src.width;
		var h = src.height;
		var canvas = document.createElement('canvas');
		var swap = deg === 90 || deg === 270;
		canvas.width = swap ? h : w;
		canvas.height = swap ? w : h;
		var ctx = canvas.getContext('2d');
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate((deg * Math.PI) / 180);
		ctx.drawImage(src, -w / 2, -h / 2);
		return canvas;
	};

	/** Add or remove columns/rows from the grid (clamped to 1..20). */
	MichiApp.prototype.nudgeGrid = function (dCols, dRows) {
		this.state.cols = Math.max(1, Math.min(20, this.state.cols + dCols));
		this.state.rows = Math.max(1, Math.min(20, this.state.rows + dRows));
		this.clearSpans(); // pocket indices change with the grid
		this.refreshControlValues();
		this.renderPreview();
	};

	MichiApp.prototype.refreshControlValues = function () {
		this.colStepValue.textContent = this.state.cols;
		this.rowStepValue.textContent = this.state.rows;
		this.zoomInput.value = Math.round(this.state.zoom * 100);
		this.updateZoomLabel();
		this.markColorSelect.value = this.state.markColor;
		this.cardPresetSelect.value = this.state.cardPreset;
		this.customSizeField.style.display = this.state.cardPreset === 'custom' ? '' : 'none';
		this.cardWInput.value = this.toDisplay(this.state.cardWidthMm);
		this.cardHInput.value = this.toDisplay(this.state.cardHeightMm);
		this.vGapInput.value = this.toDisplay(this.state.vGapMm);
		this.hGapInput.value = this.toDisplay(this.state.hGapMm);
		var unitLabel = this.state.units;
		this.cardWInput.setAttribute('aria-label', 'Card width in ' + unitLabel);
		this.cardHInput.setAttribute('aria-label', 'Card height in ' + unitLabel);
	};

	MichiApp.prototype.loadFile = function (file) {
		var self = this;
		if (!file.type || file.type.indexOf('image/') !== 0) {
			window.alert('Please choose an image file.');
			return;
		}
		var reader = new FileReader();
		reader.onload = function (e) {
			var img = new Image();
			img.onload = function () {
				self.sourceImage = img;
				self.state.rotation = 0;
				self.image = img;
				self.state.offsetX = 0;
				self.state.offsetY = 0;
				self.applyDefaultGrid();
				self.printButton.removeAttribute('disabled');
				self.root.classList.add('has-image');
				self.refreshControlValues();
				self.renderPreview();
			};
			img.onerror = function () {
				window.alert('Could not load that image. Please try a different file.');
			};
			img.src = e.target.result;
		};
		reader.readAsDataURL(file);
	};

	/**
	 * The art area in millimeters (the full reassembled print region). This
	 * includes the inter-pocket seam gaps, so the image is mapped continuously
	 * across the whole physical board and pieces stay aligned with each other.
	 */
	MichiApp.prototype.artSizeMm = function () {
		var s = this.state;
		return {
			w: s.cols * s.cardWidthMm + Math.max(0, s.cols - 1) * s.vGapMm,
			h: s.rows * s.cardHeightMm + Math.max(0, s.rows - 1) * s.hGapMm
		};
	};

	/** Left/top of a pocket window, in mm (within the trim area). */
	MichiApp.prototype.pocketX = function (col) {
		return col * (this.state.cardWidthMm + this.state.vGapMm);
	};
	MichiApp.prototype.pocketY = function (row) {
		return row * (this.state.cardHeightMm + this.state.hGapMm);
	};

	/** The mm rectangle of a span/cell {c0,r0,c1,r1}, including internal seam gaps. */
	MichiApp.prototype.pieceRectMm = function (span) {
		var s = this.state;
		return {
			c0: span.c0,
			r0: span.r0,
			c1: span.c1,
			r1: span.r1,
			xMm: this.pocketX(span.c0),
			yMm: this.pocketY(span.r0),
			wMm: (span.c1 - span.c0 + 1) * s.cardWidthMm + (span.c1 - span.c0) * s.vGapMm,
			hMm: (span.r1 - span.r0 + 1) * s.cardHeightMm + (span.r1 - span.r0) * s.hGapMm
		};
	};

	/** Index into state.spans for the span covering (col,row), or -1 if uncovered. */
	MichiApp.prototype.spanIndexForCell = function (col, row) {
		var spans = this.state.spans || [];
		for (var i = 0; i < spans.length; i++) {
			var sp = spans[i];
			if (col >= sp.c0 && col <= sp.c1 && row >= sp.r0 && row <= sp.r1) {
				return i;
			}
		}
		return -1;
	};

	/**
	 * The full list of printable pieces: one rect per valid span, plus a 1x1
	 * piece for every pocket not covered by a span. Out-of-bounds spans are
	 * skipped defensively.
	 */
	MichiApp.prototype.pieces = function () {
		var s = this.state;
		var self = this;
		var list = [];
		var covered = {};
		(s.spans || []).forEach(function (sp) {
			if (sp.c0 < 0 || sp.r0 < 0 || sp.c1 >= s.cols || sp.r1 >= s.rows || sp.c1 < sp.c0 || sp.r1 < sp.r0) {
				return;
			}
			for (var r = sp.r0; r <= sp.r1; r++) {
				for (var c = sp.c0; c <= sp.c1; c++) {
					covered[c + ',' + r] = true;
				}
			}
			list.push(self.pieceRectMm(sp));
		});
		for (var row = 0; row < s.rows; row++) {
			for (var col = 0; col < s.cols; col++) {
				if (!covered[col + ',' + row]) {
					list.push(self.pieceRectMm({ c0: col, r0: row, c1: col, r1: row }));
				}
			}
		}
		return list;
	};

	/** Remove any spans, clamp/normalize, used after grid or card changes. */
	MichiApp.prototype.clearSpans = function () {
		this.state.spans = [];
		this.state.selection = null;
	};

	function rectsIntersect(a, b) {
		return !(a.c1 < b.c0 || a.c0 > b.c1 || a.r1 < b.r0 || a.r0 > b.r1);
	}

	/** Toggle the pocket-selection mode (vs image panning). */
	MichiApp.prototype.setSelectMode = function (on) {
		this.state.selectMode = !!on;
		if (!this.state.selectMode) {
			this.state.selection = null;
		}
		// renderPreview shows the assembled grid while selecting (needed to pick
		// pockets) and the per-card view otherwise.
		this.renderPreview();
	};

	/** Merge the current selection into one uncut spanning piece. */
	MichiApp.prototype.mergeSelection = function () {
		var sel = this.state.selection;
		if (!sel) {
			return;
		}
		var single = sel.c0 === sel.c1 && sel.r0 === sel.r1;
		// Drop any existing spans overlapping the selection, then add the new one
		// (unless it is a single pocket, which is just an un-merge).
		this.state.spans = this.state.spans.filter(function (sp) {
			return !rectsIntersect(sp, sel);
		});
		if (!single) {
			this.state.spans.push({ c0: sel.c0, r0: sel.r0, c1: sel.c1, r1: sel.r1 });
		}
		this.state.selection = null;
		this.renderPreview();
	};

	/** Split (un-merge) any spans intersecting the current selection. */
	MichiApp.prototype.splitSelection = function () {
		var sel = this.state.selection;
		if (!sel) {
			return;
		}
		this.state.spans = this.state.spans.filter(function (sp) {
			return !rectsIntersect(sp, sel);
		});
		this.state.selection = null;
		this.renderPreview();
	};

	/** Reflect selection state in the spanning control buttons. */
	MichiApp.prototype.updateSpanControls = function () {
		if (!this.selectToggle) {
			return;
		}
		var on = this.state.selectMode;
		this.selectToggle.classList.toggle('is-active', on);
		this.selectToggle.textContent = on ? 'Done selecting' : 'Select pockets';
		var hasSel = !!this.state.selection;
		this.mergeButton.disabled = !on || !hasSel;
		this.splitButton.disabled = !on || !hasSel;
		var hint;
		if (!on) {
			hint = 'Click "Select pockets", then drag across pockets to merge them into one uncut piece.';
		} else if (!hasSel) {
			hint = 'Drag across two or more pockets in the preview to select them.';
		} else {
			var sel = this.state.selection;
			hint =
				'Selected ' +
				(sel.c1 - sel.c0 + 1) +
				' x ' +
				(sel.r1 - sel.r0 + 1) +
				' pockets. Choose Merge (one piece) or Split (separate again).';
		}
		this.spanHint.textContent = hint;
	};

	/**
	 * Clamp the pan offset so the image keeps covering the grid (cover) or
	 * stays within it (contain). Offsets are stored in mm (art-area coords).
	 */
	MichiApp.prototype.clampOffset = function () {
		if (!this.image) {
			return;
		}
		var art = this.artSizeMm();
		var place = placementMm(art.w, art.h, this.image.width, this.image.height, this.state.zoom, 0, 0);
		var maxX = Math.abs(place.dW - art.w) / 2;
		var maxY = Math.abs(place.dH - art.h) / 2;
		this.state.offsetX = Math.max(-maxX, Math.min(maxX, this.state.offsetX));
		this.state.offsetY = Math.max(-maxY, Math.min(maxY, this.state.offsetY));
	};

	/**
	 * Make the preview canvas draggable to pan the image within the grid.
	 */
	/** Map a pointer event to a pocket {col,row} using the assembled layout. */
	MichiApp.prototype.cellFromEvent = function (e) {
		var L = this._previewLayout;
		if (!L || !L.canvas) {
			return null;
		}
		var rect = L.canvas.getBoundingClientRect();
		var pitchX = L.cellW + L.vGapPx;
		var pitchY = L.cellH + L.hGapPx;
		var col = Math.floor((e.clientX - rect.left - L.ox) / pitchX);
		var row = Math.floor((e.clientY - rect.top - L.oy) / pitchY);
		col = Math.max(0, Math.min(L.cols - 1, col));
		row = Math.max(0, Math.min(L.rows - 1, row));
		return { col: col, row: row };
	};

	MichiApp.prototype.attachDrag = function () {
		var self = this;
		var mode = null; // 'pan' or 'select'
		var lastX = 0;
		var lastY = 0;
		var startCell = null;
		var canvas = this.previewCanvas;

		canvas.addEventListener('pointerdown', function (e) {
			if (!self.image) {
				return;
			}
			if (self.state.selectMode) {
				var cell = self.cellFromEvent(e);
				if (!cell) {
					return;
				}
				mode = 'select';
				startCell = cell;
				self.state.selection = { c0: cell.col, r0: cell.row, c1: cell.col, r1: cell.row };
				self.renderPreview();
			} else {
				mode = 'pan';
				lastX = e.clientX;
				lastY = e.clientY;
				canvas.classList.add('is-dragging');
			}
			if (canvas.setPointerCapture) {
				canvas.setPointerCapture(e.pointerId);
			}
			e.preventDefault();
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!mode || !self.image) {
				return;
			}
			if (mode === 'select') {
				var cell = self.cellFromEvent(e);
				if (!cell || !startCell) {
					return;
				}
				self.state.selection = {
					c0: Math.min(startCell.col, cell.col),
					r0: Math.min(startCell.row, cell.row),
					c1: Math.max(startCell.col, cell.col),
					r1: Math.max(startCell.row, cell.row)
				};
				self.renderPreview();
			} else {
				var ppm = self._previewPxPerMm || 1;
				self.state.offsetX += (e.clientX - lastX) / ppm;
				self.state.offsetY += (e.clientY - lastY) / ppm;
				lastX = e.clientX;
				lastY = e.clientY;
				self.renderPreview();
			}
		});

		function endDrag() {
			if (mode) {
				mode = null;
				startCell = null;
				canvas.classList.remove('is-dragging');
				self.renderPreview();
			}
		}
		canvas.addEventListener('pointerup', endDrag);
		canvas.addEventListener('pointercancel', endDrag);
	};

	/**
	 * Quality badge. At 100% zoom (or less) the print is at least PRINT_DPI and
	 * crisp. Zooming past 100% upscales the image, lowering the effective DPI;
	 * once it gets low enough we warn that it may look pixelated.
	 */
	MichiApp.prototype.updateQuality = function () {
		var node = this.qualityEl;
		if (!this.image) {
			node.style.display = 'none';
			return;
		}
		node.style.display = '';
		node.innerHTML = '';

		var z = this.state.zoom;
		var dpi = Math.round(PRINT_DPI / z);
		var wmm = (this.image.width / PX_PER_MM) * z;
		var hmm = (this.image.height / PX_PER_MM) * z;
		var sizeStr =
			this.state.units === 'in'
				? round(wmm / MM_PER_INCH, 2) + ' x ' + round(hmm / MM_PER_INCH, 2) + ' in'
				: Math.round(wmm) + ' x ' + Math.round(hmm) + ' mm';

		var level, detail;
		if (dpi >= 299.5) {
			level = 'good';
			detail = 'Sharp at about ' + dpi + ' DPI. No upscaling.';
		} else if (dpi >= 200) {
			level = 'fair';
			detail = 'About ' + dpi + ' DPI. Slightly enlarged past true size, but should still look fine.';
		} else if (dpi >= 150) {
			level = 'warn';
			detail = 'About ' + dpi + ' DPI. Enlarged past true size; print may look a little soft.';
		} else {
			level = 'low';
			detail = 'About ' + dpi + ' DPI. Enlarged well past true size; this will likely look pixelated. Zoom out to fix.';
		}
		node.className = 'mm-quality mm-quality--' + level;

		node.appendChild(
			el('strong', { text: 'Image at ' + Math.round(z * 100) + '% of true size (' + sizeStr + ' on paper).' })
		);
		node.appendChild(el('span', { class: 'mm-quality-detail', text: detail }));
	};

	MichiApp.prototype.renderPreview = function () {
		var canvas = this.previewCanvas;
		if (!this.image) {
			// Empty state: the dropzone shows (CSS, based on .has-image).
			canvas.style.display = 'none';
			if (this.qualityEl) {
				this.qualityEl.style.display = 'none';
			}
			return;
		}
		canvas.style.display = 'block';

		this.clampOffset();

		// Per-card is the only preview, except while selecting pockets to span,
		// which needs the assembled grid to pick from.
		if (this.state.selectMode) {
			this.renderAssembledPreview(canvas);
		} else {
			this.renderExplodedPreview(canvas);
		}

		canvas.classList.toggle('is-selecting', !!this.state.selectMode);
		if (this.previewHint) {
			this.previewHint.textContent = this.state.selectMode
				? 'Drag across pockets to select them, then Merge or Split.'
				: 'Drag the image to reposition it within the grid.';
		}
		this.updateSpanControls();
		this.updateQuality();
	};

	MichiApp.prototype.renderAssembledPreview = function (canvas) {
		var s = this.state;
		var art = this.artSizeMm();
		var outerAspect = art.w / art.h;

		var maxW = Math.min(this.previewWrap.clientWidth || 480, 560);
		if (maxW < 200) {
			maxW = 480;
		}
		var viewW = maxW;
		var viewH = viewW / outerAspect;
		var maxH = 520;
		if (viewH > maxH) {
			viewH = maxH;
			viewW = viewH * outerAspect;
		}

		var dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(viewW * dpr);
		canvas.height = Math.round(viewH * dpr);
		canvas.style.width = viewW + 'px';
		canvas.style.height = viewH + 'px';

		var ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, viewW, viewH);

		var scale = viewW / art.w; // preview px per mm
		this._previewPxPerMm = scale;
		var cellW = s.cardWidthMm * scale;
		var cellH = s.cardHeightMm * scale;
		var vGapPx = s.vGapMm * scale;
		var hGapPx = s.hGapMm * scale;
		var ox = 0; // trim-area origin within the canvas
		var oy = 0;

		// Remember the layout so pointer events can map to pocket indices.
		this._previewLayout = {
			canvas: canvas,
			ox: ox,
			oy: oy,
			cellW: cellW,
			cellH: cellH,
			vGapPx: vGapPx,
			hGapPx: hGapPx,
			cols: s.cols,
			rows: s.rows
		};

		var self = this;
		function pocketLeft(col) {
			return ox + col * (cellW + vGapPx);
		}
		function pocketTop(row) {
			return oy + row * (cellH + hGapPx);
		}
		// Pixel rect of a piece/cell rectangle within the preview.
		function pieceRectPx(p) {
			return {
				x: pocketLeft(p.c0),
				y: pocketTop(p.r0),
				w: (p.c1 - p.c0 + 1) * cellW + (p.c1 - p.c0) * vGapPx,
				h: (p.r1 - p.r0 + 1) * cellH + (p.r1 - p.r0) * hGapPx
			};
		}

		// Background + image, placed at its true size scaled by zoom and panned.
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, viewW, viewH);
		var pm = placementMm(art.w, art.h, this.image.width, this.image.height, s.zoom, s.offsetX, s.offsetY);
		ctx.drawImage(this.image, ox + pm.dx * scale, oy + pm.dy * scale, pm.dW * scale, pm.dH * scale);

		var col, row;

		// Shade seam gaps that fall BETWEEN separate pieces (these are trimmed
		// off / discarded). Gaps interior to a spanning piece are left showing
		// the image, since that art prints continuously behind the pocket seam.
		if ((vGapPx > 0.5 || hGapPx > 0.5)) {
			ctx.save();
			ctx.fillStyle = 'rgba(120,120,120,0.30)';
			// Vertical seam segments (between columns), per row.
			for (row = 0; row < s.rows; row++) {
				for (col = 0; col < s.cols - 1; col++) {
					var interiorV =
						self.spanIndexForCell(col, row) === self.spanIndexForCell(col + 1, row) &&
						self.spanIndexForCell(col, row) >= 0;
					if (!interiorV && vGapPx > 0.5) {
						ctx.fillRect(pocketLeft(col) + cellW, pocketTop(row), vGapPx, cellH);
					}
				}
			}
			// Horizontal seam segments (between rows), per column.
			for (row = 0; row < s.rows - 1; row++) {
				for (col = 0; col < s.cols; col++) {
					var interiorH =
						self.spanIndexForCell(col, row) === self.spanIndexForCell(col, row + 1) &&
						self.spanIndexForCell(col, row) >= 0;
					if (!interiorH && hGapPx > 0.5) {
						ctx.fillRect(pocketLeft(col), pocketTop(row) + cellH, cellW, hGapPx);
					}
				}
			}
			// Corner seam squares (between four pockets).
			for (row = 0; row < s.rows - 1; row++) {
				for (col = 0; col < s.cols - 1; col++) {
					var a = self.spanIndexForCell(col, row);
					var interiorC =
						a >= 0 &&
						a === self.spanIndexForCell(col + 1, row) &&
						a === self.spanIndexForCell(col, row + 1) &&
						a === self.spanIndexForCell(col + 1, row + 1);
					if (!interiorC && vGapPx > 0.5 && hGapPx > 0.5) {
						ctx.fillRect(pocketLeft(col) + cellW, pocketTop(row) + cellH, vGapPx, hGapPx);
					}
				}
			}
			ctx.restore();
		}

		var list = this.pieces();

		// Solid cut / trim lines: the outer boundary of each piece (no internal
		// lines inside a spanning piece, since you do not cut there).
		if (this.marksVisible()) {
			ctx.setLineDash([]);
			ctx.lineWidth = 1;
			ctx.strokeStyle = this.markColorHex();
			list.forEach(function (p) {
				var r = pieceRectPx(p);
				ctx.strokeRect(Math.round(r.x) + 0.5, Math.round(r.y) + 0.5, Math.round(r.w) - 1, Math.round(r.h) - 1);
			});
		}

		// Selection highlight while choosing pockets to merge.
		if (s.selectMode && s.selection) {
			var sr = pieceRectPx(s.selection);
			ctx.save();
			ctx.fillStyle = 'rgba(37,99,235,0.22)';
			ctx.fillRect(sr.x, sr.y, sr.w, sr.h);
			ctx.setLineDash([5, 3]);
			ctx.strokeStyle = 'rgba(37,99,235,0.95)';
			ctx.lineWidth = 2;
			ctx.strokeRect(sr.x + 1, sr.y + 1, sr.w - 2, sr.h - 2);
			ctx.restore();
		}
	};

	/**
	 * Exploded preview: each card is drawn as its own print tile, separated by
	 * gaps, mirroring what actually comes out of the printer.
	 */
	MichiApp.prototype.renderExplodedPreview = function (canvas) {
		var s = this.state;

		// Lay pieces out in a greedy wrapping flow, since spanning pieces have
		// varying sizes and no longer fit a uniform grid.
		var unitWmm = s.cardWidthMm;
		var unitHmm = s.cardHeightMm;
		var gapMm = Math.max(unitWmm, unitHmm) * 0.14;
		var maxRowWmm = s.cols * unitWmm + Math.max(0, s.cols - 1) * gapMm;

		var list = this.pieces();
		var layout = [];
		var cx = 0;
		var cy = 0;
		var rowH = 0;
		var totalWmm = 0;
		list.forEach(function (p) {
			var tw = p.wMm;
			var th = p.hMm;
			if (cx > 0 && cx + tw > maxRowWmm + 0.01) {
				cy += rowH + gapMm;
				cx = 0;
				rowH = 0;
			}
			layout.push({ p: p, x: cx, y: cy, tw: tw, th: th });
			cx += tw + gapMm;
			if (th > rowH) {
				rowH = th;
			}
			if (cx - gapMm > totalWmm) {
				totalWmm = cx - gapMm;
			}
		});
		var totalHmm = cy + rowH;
		if (totalWmm <= 0) {
			totalWmm = maxRowWmm;
		}
		if (totalHmm <= 0) {
			totalHmm = unitHmm;
		}

		var maxW = Math.min(this.previewWrap.clientWidth || 480, 560);
		if (maxW < 200) {
			maxW = 480;
		}
		var scale = maxW / totalWmm;
		var viewW = maxW;
		var viewH = totalHmm * scale;
		var maxH = 520;
		if (viewH > maxH) {
			scale = maxH / totalHmm;
			viewH = maxH;
			viewW = totalWmm * scale;
		}

		var dpr = window.devicePixelRatio || 1;
		canvas.width = Math.round(viewW * dpr);
		canvas.height = Math.round(viewH * dpr);
		canvas.style.width = viewW + 'px';
		canvas.style.height = viewH + 'px';
		var ctx = canvas.getContext('2d');
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, viewW, viewH);

		// The exploded view is not interactive for selection.
		this._previewLayout = null;
		this._previewPxPerMm = scale;
		var markColor = this.markColorHex();
		var showMarks = this.marksVisible();

		layout.forEach(function (item) {
			var p = item.p;
			var tx = item.x * scale;
			var ty = item.y * scale;

			var contentX = tx;
			var contentY = ty;
			var cardWpx = p.wMm * scale;
			var cardHpx = p.hMm * scale;

			var pieceCanvas = this.renderPieceCanvas(p);
			ctx.fillStyle = '#ffffff';
			ctx.fillRect(contentX, contentY, cardWpx, cardHpx);
			ctx.drawImage(pieceCanvas, contentX, contentY, cardWpx, cardHpx);

			var cardX = contentX;
			var cardY = contentY;

			// Piece boundary = the cut line (outer edge only).
			if (showMarks) {
				ctx.setLineDash([]);
				ctx.lineWidth = 1;
				ctx.strokeStyle = markColor;
				ctx.strokeRect(cardX + 0.5, cardY + 0.5, cardWpx - 1, cardHpx - 1);
			}

			// Position label to help reassembly. Spans note their pocket extent.
			var label = 'R' + (p.r0 + 1) + 'C' + (p.c0 + 1);
			if (p.c1 > p.c0 || p.r1 > p.r0) {
				label += ' span ' + (p.c1 - p.c0 + 1) + 'x' + (p.r1 - p.r0 + 1);
			}
			ctx.fillStyle = markColor;
			ctx.globalAlpha = 0.65;
			ctx.font = '10px sans-serif';
			ctx.textBaseline = 'top';
			ctx.textAlign = 'left';
			ctx.fillText(label, tx + 1, ty + 1);
			ctx.globalAlpha = 1;
		}, this);
	};

	/**
	 * Render one piece canvas at print resolution. The piece is a mm rectangle
	 * (from `pieces()`) which may span multiple pockets; the image is sampled
	 * from the same full-extent placement so every piece stays aligned.
	 */
	MichiApp.prototype.renderPieceCanvas = function (piece) {
		var s = this.state;
		var art = this.artSizeMm();

		var pm = placementMm(art.w, art.h, this.image.width, this.image.height, s.zoom, s.offsetX, s.offsetY);
		var place = {
			dx: pm.dx * PX_PER_MM,
			dy: pm.dy * PX_PER_MM,
			dW: pm.dW * PX_PER_MM,
			dH: pm.dH * PX_PER_MM
		};

		var pieceWpx = piece.wMm * PX_PER_MM;
		var pieceHpx = piece.hMm * PX_PER_MM;

		var tileWpx = Math.round(pieceWpx);
		var tileHpx = Math.round(pieceHpx);

		var canvas = document.createElement('canvas');
		canvas.width = tileWpx;
		canvas.height = tileHpx;
		var ctx = canvas.getContext('2d');
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, tileWpx, tileHpx);

		// Top-left of this piece in art-area pixel coords.
		var tileOriginX = piece.xMm * PX_PER_MM;
		var tileOriginY = piece.yMm * PX_PER_MM;

		// Draw the placed image into the piece's coordinate space.
		ctx.drawImage(
			this.image,
			place.dx - tileOriginX,
			place.dy - tileOriginY,
			place.dW,
			place.dH
		);

		return canvas;
	};

	/**
	 * Build the cut-line rectangle drawn at the card (trim) boundary so the
	 * print page clearly shows where to cut, matching the preview.
	 */
	MichiApp.prototype.buildCutLine = function (color, trimWmm, trimHmm) {
		return el('div', {
			class: 'mm-cut-line',
			style:
				'left:0mm;top:0mm;' +
				'width:' + trimWmm + 'mm;height:' + trimHmm + 'mm;' +
				'border-color:' + color + ';'
		});
	};

	MichiApp.prototype.print = function () {
		if (!this.image) {
			return;
		}
		this.printRoot.innerHTML = '';

		var markColor = this.markColorHex();

		// One printed tile per piece. Spanning pieces print as a single uncut
		// strip; the seam-gap region inside them is printed but hides behind the
		// pocket divider, keeping the art continuous across the windows.
		var list = this.pieces();
		for (var i = 0; i < list.length; i++) {
			var piece = list[i];
			var tileOuterW = piece.wMm;
			var tileOuterH = piece.hMm;

			var canvas = this.renderPieceCanvas(piece);
			var img = canvas; // canvas prints fine directly
			img.className = 'mm-tile-canvas';
			img.style.width = piece.wMm + 'mm';
			img.style.height = piece.hMm + 'mm';
			img.style.left = '0mm';
			img.style.top = '0mm';

			// Cut line (outer boundary of the piece) unless marks are disabled.
			var children = [img];
			if (this.marksVisible()) {
				children.push(this.buildCutLine(markColor, piece.wMm, piece.hMm));
			}

			var tile = el('div', {
				class: 'mm-tile',
				style: 'width:' + tileOuterW + 'mm;height:' + tileOuterH + 'mm;'
			}, children);

			this.printRoot.appendChild(tile);
		}

		var cleanup = function () {
			window.removeEventListener('afterprint', cleanup);
		};
		window.addEventListener('afterprint', cleanup);
		window.print();
	};

	function init() {
		var nodes = document.querySelectorAll('.michi-method');
		Array.prototype.forEach.call(nodes, function (node) {
			if (node._michiInit) {
				return;
			}
			node._michiInit = true;
			try {
				new MichiApp(node);
			} catch (err) {
				if (window.console && window.console.error) {
					window.console.error('Michi Method init failed', err);
				}
			}
		});
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', init);
	} else {
		init();
	}
})();
