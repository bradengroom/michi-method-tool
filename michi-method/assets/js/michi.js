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
	var MARK_MARGIN_MM = 4; // Reserved gutter around a tile for crop marks.
	var MARK_LEN_MM = 3; // Length of each crop-mark tick.

	var PRESETS = [
		{ label: '1 x 1', cols: 1, rows: 1 },
		{ label: '2 x 2', cols: 2, rows: 2 },
		{ label: '3 x 3', cols: 3, rows: 3 },
		{ label: '3 x 4', cols: 3, rows: 4 },
		{ label: 'Custom', cols: 0, rows: 0 }
	];

	// Common trading-card sizes in millimeters. Several games share the 63x88mm
	// "standard" size; they are listed separately so the common case is obvious.
	var CARD_PRESETS = [
		{ id: 'pokemon', label: 'Pokemon (63 x 88 mm)', w: 63, h: 88 },
		{ id: 'mtg', label: 'Magic: The Gathering (63 x 88 mm)', w: 63, h: 88 },
		{ id: 'onepiece', label: 'One Piece (63 x 88 mm)', w: 63, h: 88 },
		{ id: 'lorcana', label: 'Lorcana (63 x 88 mm)', w: 63, h: 88 },
		{ id: 'yugioh', label: 'Yu-Gi-Oh! (59 x 86 mm)', w: 59, h: 86 },
		{ id: 'mini', label: 'Mini (44 x 67 mm)', w: 44, h: 67 },
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
			rows: parseInt(root.getAttribute('data-default-rows'), 10) || 3,
			cardWidthMm: parseFloat(root.getAttribute('data-card-width-mm')) || 63,
			cardHeightMm: parseFloat(root.getAttribute('data-card-height-mm')) || 88,
			bleedMm: parseFloat(root.getAttribute('data-default-bleed-mm')) || 0,
			cropMarks: root.getAttribute('data-crop-marks') === 'true',
			markColor: root.getAttribute('data-mark-color') === 'white' ? 'white' : 'black',
			zoom: 1, // 1 = true size; only goes below 1 (never upscales)
			previewMode: 'assembled',
			offsetX: 0, // image pan within the grid, in mm (art-area coords)
			offsetY: 0,
			units: root.getAttribute('data-default-units') === 'in' ? 'in' : 'mm'
		};
		this.state.cardPreset = detectCardPreset(this.state.cardWidthMm, this.state.cardHeightMm);
		this.build();
		this.refreshControlValues();
		this.renderPreview();
	}

	MichiApp.prototype.markColorHex = function () {
		return this.state.markColor === 'white' ? '#ffffff' : '#000000';
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

		this.tool.appendChild(this.dropzone);

		// Controls.
		this.tool.appendChild(this.buildControls());

		// Preview.
		this.previewCanvas = el('canvas', { class: 'mm-preview-canvas' });
		this.previewHint = el('div', { class: 'mm-preview-hint', text: 'Drag the image to reposition it within the grid.' });
		this.previewWrap = el('div', { class: 'mm-preview' }, [
			el('div', { class: 'mm-preview-empty', text: 'Upload an image to see a preview.' }),
			this.previewCanvas,
			this.previewHint
		]);
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
		this.resetButton = el('button', {
			type: 'button',
			class: 'mm-reset-btn',
			text: 'Recenter image',
			onClick: function () {
				self.state.offsetX = 0;
				self.state.offsetY = 0;
				self.renderPreview();
			}
		});
		this.tool.appendChild(el('div', { class: 'mm-actions' }, [this.printButton, this.resetButton]));

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

		// Grid preset buttons.
		this.presetWrap = el('div', { class: 'mm-presets' });
		PRESETS.forEach(function (preset) {
			var btn = el('button', {
				type: 'button',
				class: 'mm-preset',
				text: preset.label,
				onClick: function () {
					self.applyPreset(preset);
				}
			});
			btn._preset = preset;
			self.presetWrap.appendChild(btn);
		});
		controls.appendChild(this.field('Binder grid', this.presetWrap));

		// Custom cols/rows.
		this.colsInput = el('input', { type: 'number', min: '1', max: '20', class: 'mm-num' });
		this.rowsInput = el('input', { type: 'number', min: '1', max: '20', class: 'mm-num' });
		this.colsInput.addEventListener('input', function () {
			self.state.cols = Math.max(1, parseInt(self.colsInput.value, 10) || 1);
			self.syncPresetSelection();
			self.renderPreview();
		});
		this.rowsInput.addEventListener('input', function () {
			self.state.rows = Math.max(1, parseInt(self.rowsInput.value, 10) || 1);
			self.syncPresetSelection();
			self.renderPreview();
		});
		controls.appendChild(
			this.field(
				'Columns x rows',
				el('div', { class: 'mm-inline' }, [
					this.colsInput,
					el('span', { class: 'mm-x', text: 'x' }),
					this.rowsInput
				])
			)
		);

		// Units toggle.
		this.unitsSelect = el('select', { class: 'mm-select' }, [
			el('option', { value: 'mm', text: 'mm' }),
			el('option', { value: 'in', text: 'inches' })
		]);
		this.unitsSelect.addEventListener('change', function () {
			self.state.units = self.unitsSelect.value === 'in' ? 'in' : 'mm';
			self.refreshControlValues();
			self.renderPreview();
		});
		controls.appendChild(this.field('Units', this.unitsSelect));

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
			'Custom card size',
			el('div', { class: 'mm-inline' }, [
				this.cardWInput,
				el('span', { class: 'mm-x', text: 'x' }),
				this.cardHInput
			])
		);
		controls.appendChild(this.customSizeField);

		// Fit mode.
		this.zoomInput = el('input', { type: 'range', min: '10', max: '400', step: '1', class: 'mm-range' });
		this.zoomValue = el('span', { class: 'mm-range-value' });
		this.zoomInput.addEventListener('input', function () {
			var pct = parseInt(self.zoomInput.value, 10) || 100;
			self.state.zoom = Math.max(0.1, Math.min(4, pct / 100));
			self.updateZoomLabel();
			self.renderPreview();
		});
		controls.appendChild(
			this.field('Zoom (100% = true size)', el('div', { class: 'mm-inline' }, [this.zoomInput, this.zoomValue]))
		);

		// Preview mode.
		this.viewSelect = el('select', { class: 'mm-select' }, [
			el('option', { value: 'assembled', text: 'Assembled (reassembled image)' }),
			el('option', { value: 'exploded', text: 'Per-card (print tiles)' })
		]);
		this.viewSelect.addEventListener('change', function () {
			self.state.previewMode = self.viewSelect.value;
			self.renderPreview();
		});
		controls.appendChild(this.field('Preview', this.viewSelect));

		// Bleed.
		this.bleedInput = el('input', { type: 'number', step: 'any', min: '0', class: 'mm-num' });
		this.bleedInput.addEventListener('input', function () {
			self.state.bleedMm = Math.max(0, self.fromDisplay(self.bleedInput.value));
			self.renderPreview();
		});
		controls.appendChild(this.field('Bleed (extra to trim)', this.bleedInput));

		// Crop marks toggle.
		this.cropToggle = el('input', { type: 'checkbox', class: 'mm-check' });
		this.cropToggle.addEventListener('change', function () {
			self.state.cropMarks = self.cropToggle.checked;
			self.renderPreview();
		});
		controls.appendChild(
			this.field(
				'',
				el('label', { class: 'mm-checkline' }, [this.cropToggle, el('span', { text: 'Add corner crop marks' })])
			)
		);

		// Mark / cut-line color.
		this.markColorSelect = el('select', { class: 'mm-select' }, [
			el('option', { value: 'black', text: 'Black' }),
			el('option', { value: 'white', text: 'White' })
		]);
		this.markColorSelect.addEventListener('change', function () {
			self.state.markColor = self.markColorSelect.value === 'white' ? 'white' : 'black';
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

	MichiApp.prototype.applyPreset = function (preset) {
		if (preset.cols > 0) {
			this.state.cols = preset.cols;
			this.state.rows = preset.rows;
		}
		this.refreshControlValues();
		this.syncPresetSelection();
		this.renderPreview();
		if (preset.cols === 0) {
			this.colsInput.focus();
		}
	};

	MichiApp.prototype.syncPresetSelection = function () {
		var self = this;
		var matched = false;
		Array.prototype.forEach.call(this.presetWrap.children, function (btn) {
			var p = btn._preset;
			var active = p.cols === self.state.cols && p.rows === self.state.rows && p.cols > 0;
			if (active) {
				matched = true;
			}
			btn.classList.toggle('is-active', active);
		});
		Array.prototype.forEach.call(this.presetWrap.children, function (btn) {
			if (btn._preset.cols === 0) {
				btn.classList.toggle('is-active', !matched);
			}
		});
	};

	MichiApp.prototype.refreshControlValues = function () {
		this.colsInput.value = this.state.cols;
		this.rowsInput.value = this.state.rows;
		this.unitsSelect.value = this.state.units;
		this.zoomInput.value = Math.round(this.state.zoom * 100);
		this.updateZoomLabel();
		this.viewSelect.value = this.state.previewMode;
		this.cropToggle.checked = this.state.cropMarks;
		this.markColorSelect.value = this.state.markColor;
		this.cardPresetSelect.value = this.state.cardPreset;
		this.customSizeField.style.display = this.state.cardPreset === 'custom' ? '' : 'none';
		this.cardWInput.value = this.toDisplay(this.state.cardWidthMm);
		this.cardHInput.value = this.toDisplay(this.state.cardHeightMm);
		this.bleedInput.value = this.toDisplay(this.state.bleedMm);
		var unitLabel = this.state.units;
		this.cardWInput.setAttribute('aria-label', 'Card width in ' + unitLabel);
		this.cardHInput.setAttribute('aria-label', 'Card height in ' + unitLabel);
		this.syncPresetSelection();
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
				self.image = img;
				self.state.offsetX = 0;
				self.state.offsetY = 0;
				self.printButton.removeAttribute('disabled');
				self.root.classList.add('has-image');
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
	 * The art area in millimeters (the full reassembled print region).
	 */
	MichiApp.prototype.artSizeMm = function () {
		return {
			w: this.state.cols * this.state.cardWidthMm,
			h: this.state.rows * this.state.cardHeightMm
		};
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
	MichiApp.prototype.attachDrag = function () {
		var self = this;
		var dragging = false;
		var lastX = 0;
		var lastY = 0;
		var canvas = this.previewCanvas;

		canvas.addEventListener('pointerdown', function (e) {
			if (!self.image) {
				return;
			}
			dragging = true;
			lastX = e.clientX;
			lastY = e.clientY;
			if (canvas.setPointerCapture) {
				canvas.setPointerCapture(e.pointerId);
			}
			canvas.classList.add('is-dragging');
			e.preventDefault();
		});

		canvas.addEventListener('pointermove', function (e) {
			if (!dragging || !self.image) {
				return;
			}
			var ppm = self._previewPxPerMm || 1;
			self.state.offsetX += (e.clientX - lastX) / ppm;
			self.state.offsetY += (e.clientY - lastY) / ppm;
			lastX = e.clientX;
			lastY = e.clientY;
			self.renderPreview();
		});

		function endDrag() {
			if (dragging) {
				dragging = false;
				canvas.classList.remove('is-dragging');
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
		var empty = this.previewWrap.querySelector('.mm-preview-empty');
		if (!this.image) {
			if (empty) {
				empty.style.display = '';
			}
			canvas.style.display = 'none';
			if (this.qualityEl) {
				this.qualityEl.style.display = 'none';
			}
			return;
		}
		if (empty) {
			empty.style.display = 'none';
		}
		canvas.style.display = 'block';

		this.clampOffset();

		if (this.state.previewMode === 'exploded') {
			this.renderExplodedPreview(canvas);
		} else {
			this.renderAssembledPreview(canvas);
		}

		this.updateQuality();
	};

	MichiApp.prototype.renderAssembledPreview = function (canvas) {
		var s = this.state;
		var art = this.artSizeMm();
		var bleed = s.bleedMm;

		// The preview shows the full printed extent: the trim area plus the
		// outer bleed margin, so the bleed setting is actually visible.
		var outerW = art.w + 2 * bleed;
		var outerH = art.h + 2 * bleed;
		var outerAspect = outerW / outerH;

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

		var scale = viewW / outerW; // preview px per mm
		this._previewPxPerMm = scale;
		var bleedPx = bleed * scale;
		var cellW = s.cardWidthMm * scale;
		var cellH = s.cardHeightMm * scale;
		var ox = bleedPx; // trim-area origin within the canvas
		var oy = bleedPx;
		var artWpx = art.w * scale;
		var artHpx = art.h * scale;

		// Background + image, placed at its true size scaled by zoom and panned.
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, viewW, viewH);
		var pm = placementMm(art.w, art.h, this.image.width, this.image.height, s.zoom, s.offsetX, s.offsetY);
		ctx.drawImage(this.image, ox + pm.dx * scale, oy + pm.dy * scale, pm.dW * scale, pm.dH * scale);

		var col, row, x, y;

		// Shade each card's bleed ring (the part trimmed off) in translucent red.
		if (bleedPx > 0.5) {
			ctx.save();
			ctx.fillStyle = 'rgba(220,38,38,0.16)';
			for (row = 0; row < s.rows; row++) {
				for (col = 0; col < s.cols; col++) {
					x = ox + col * cellW;
					y = oy + row * cellH;
					ctx.beginPath();
					ctx.rect(x - bleedPx, y - bleedPx, cellW + 2 * bleedPx, cellH + 2 * bleedPx);
					ctx.rect(x, y, cellW, cellH);
					ctx.fill('evenodd');
				}
			}
			ctx.restore();
		}

		// Solid cut / trim lines (the actual card boundaries = where you cut).
		ctx.setLineDash([]);
		ctx.lineWidth = 1;
		ctx.strokeStyle = this.markColorHex();
		ctx.strokeRect(ox + 0.5, oy + 0.5, artWpx - 1, artHpx - 1);
		ctx.beginPath();
		for (col = 1; col < s.cols; col++) {
			x = Math.round(ox + col * cellW) + 0.5;
			ctx.moveTo(x, oy);
			ctx.lineTo(x, oy + artHpx);
		}
		for (row = 1; row < s.rows; row++) {
			y = Math.round(oy + row * cellH) + 0.5;
			ctx.moveTo(ox, y);
			ctx.lineTo(ox + artWpx, y);
		}
		ctx.stroke();

		// Dashed outline of the full printed extent (trim + bleed).
		if (bleedPx > 0.5) {
			ctx.save();
			ctx.setLineDash([4, 3]);
			ctx.strokeStyle = 'rgba(220,38,38,0.9)';
			ctx.lineWidth = 1;
			ctx.strokeRect(0.5, 0.5, viewW - 1, viewH - 1);
			ctx.restore();
		}
	};

	/**
	 * Exploded preview: each card is drawn as its own print tile (with bleed
	 * margin and, if enabled, crop marks) separated by gaps, mirroring what
	 * actually comes out of the printer.
	 */
	MichiApp.prototype.renderExplodedPreview = function (canvas) {
		var s = this.state;
		var markMm = s.cropMarks ? MARK_MARGIN_MM : 0;
		var tileWmm = s.cardWidthMm + 2 * s.bleedMm + 2 * markMm;
		var tileHmm = s.cardHeightMm + 2 * s.bleedMm + 2 * markMm;
		var gapMm = Math.max(tileWmm, tileHmm) * 0.14;

		var totalWmm = s.cols * tileWmm + (s.cols - 1) * gapMm;
		var totalHmm = s.rows * tileHmm + (s.rows - 1) * gapMm;

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

		this._previewPxPerMm = scale;
		var tileWpx = tileWmm * scale;
		var tileHpx = tileHmm * scale;
		var gapPx = gapMm * scale;
		var bleedPx = s.bleedMm * scale;
		var markPx = markMm * scale;
		var cardWpx = s.cardWidthMm * scale;
		var cardHpx = s.cardHeightMm * scale;
		var markLenPx = MARK_LEN_MM * scale;

		for (var row = 0; row < s.rows; row++) {
			for (var col = 0; col < s.cols; col++) {
				var tx = col * (tileWpx + gapPx);
				var ty = row * (tileHpx + gapPx);

				// Card + bleed content area within the tile (inset by mark margin).
				var contentX = tx + markPx;
				var contentY = ty + markPx;
				var contentW = cardWpx + 2 * bleedPx;
				var contentH = cardHpx + 2 * bleedPx;

				var tileCanvas = this.renderTileCanvas(col, row);
				ctx.fillStyle = '#ffffff';
				ctx.fillRect(contentX, contentY, contentW, contentH);
				ctx.drawImage(tileCanvas, contentX, contentY, contentW, contentH);

				var cardX = contentX + bleedPx;
				var cardY = contentY + bleedPx;

				// Shade the bleed ring (trimmed off) in translucent red.
				if (bleedPx > 0.5) {
					ctx.save();
					ctx.fillStyle = 'rgba(220,38,38,0.18)';
					ctx.beginPath();
					ctx.rect(contentX, contentY, contentW, contentH);
					ctx.rect(cardX, cardY, cardWpx, cardHpx);
					ctx.fill('evenodd');
					ctx.restore();
				}

				// Card boundary = the cut line.
				var markColor = this.markColorHex();
				ctx.setLineDash([]);
				ctx.lineWidth = 1;
				ctx.strokeStyle = markColor;
				ctx.strokeRect(cardX + 0.5, cardY + 0.5, cardWpx - 1, cardHpx - 1);

				// Crop marks: corner ticks just outside each card corner.
				if (s.cropMarks) {
					ctx.strokeStyle = markColor;
					ctx.lineWidth = 1;
					ctx.beginPath();
					var corners = [
						[cardX, cardY, -1, -1],
						[cardX + cardWpx, cardY, 1, -1],
						[cardX, cardY + cardHpx, -1, 1],
						[cardX + cardWpx, cardY + cardHpx, 1, 1]
					];
					corners.forEach(function (cnr) {
						var px = cnr[0];
						var py = cnr[1];
						var sx = cnr[2];
						var sy = cnr[3];
						ctx.moveTo(px, py);
						ctx.lineTo(px + sx * markLenPx, py);
						ctx.moveTo(px, py);
						ctx.lineTo(px, py + sy * markLenPx);
					});
					ctx.stroke();
				}

				// Small position label to help reassembly (row, col, 1-based).
				ctx.fillStyle = markColor;
				ctx.globalAlpha = 0.65;
				ctx.font = '10px sans-serif';
				ctx.textBaseline = 'top';
				ctx.textAlign = 'left';
				ctx.fillText('R' + (row + 1) + 'C' + (col + 1), tx + 1, ty + 1);
				ctx.globalAlpha = 1;
			}
		}
	};

	/**
	 * Render one tile canvas at print resolution for grid cell (col, row).
	 */
	MichiApp.prototype.renderTileCanvas = function (col, row) {
		var s = this.state;
		var art = this.artSizeMm();

		var pm = placementMm(art.w, art.h, this.image.width, this.image.height, s.zoom, s.offsetX, s.offsetY);
		var place = {
			dx: pm.dx * PX_PER_MM,
			dy: pm.dy * PX_PER_MM,
			dW: pm.dW * PX_PER_MM,
			dH: pm.dH * PX_PER_MM
		};

		var bleedPx = s.bleedMm * PX_PER_MM;
		var cardWpx = s.cardWidthMm * PX_PER_MM;
		var cardHpx = s.cardHeightMm * PX_PER_MM;

		var tileWpx = Math.round(cardWpx + 2 * bleedPx);
		var tileHpx = Math.round(cardHpx + 2 * bleedPx);

		var canvas = document.createElement('canvas');
		canvas.width = tileWpx;
		canvas.height = tileHpx;
		var ctx = canvas.getContext('2d');
		ctx.fillStyle = '#ffffff';
		ctx.fillRect(0, 0, tileWpx, tileHpx);

		// Top-left of this tile (including bleed) in art-area pixel coords.
		var tileOriginX = col * cardWpx - bleedPx;
		var tileOriginY = row * cardHpx - bleedPx;

		// Draw the placed image into the tile's coordinate space.
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
	 * Build the 8 crop-mark tick elements for a tile, positioned at the trim
	 * box corners (inset by bleed + the reserved mark margin).
	 */
	MichiApp.prototype.buildCropMarks = function (color) {
		var s = this.state;
		var inset = MARK_MARGIN_MM + s.bleedMm; // distance from tile edge to trim line
		var trimWmm = s.cardWidthMm;
		var trimHmm = s.cardHeightMm;
		var len = MARK_LEN_MM;
		var marks = [];

		function tick(left, top, width, height) {
			return el('div', {
				class: 'mm-crop-tick',
				style:
					'left:' + left + 'mm;top:' + top + 'mm;width:' + width + 'mm;height:' + height + 'mm;' +
					'background:' + color + ';'
			});
		}

		var hair = 0.2; // mm line thickness
		var x0 = inset;
		var y0 = inset;
		var x1 = inset + trimWmm;
		var y1 = inset + trimHmm;

		// Top-left
		marks.push(tick(x0 - hair / 2, y0 - len, hair, len));
		marks.push(tick(x0 - len, y0 - hair / 2, len, hair));
		// Top-right
		marks.push(tick(x1 - hair / 2, y0 - len, hair, len));
		marks.push(tick(x1, y0 - hair / 2, len, hair));
		// Bottom-left
		marks.push(tick(x0 - hair / 2, y1, hair, len));
		marks.push(tick(x0 - len, y1 - hair / 2, len, hair));
		// Bottom-right
		marks.push(tick(x1 - hair / 2, y1, hair, len));
		marks.push(tick(x1, y1 - hair / 2, len, hair));

		return marks;
	};

	/**
	 * Build the cut-line rectangle drawn at the card (trim) boundary so the
	 * print page clearly shows where to cut, matching the preview.
	 */
	MichiApp.prototype.buildCutLine = function (color) {
		var s = this.state;
		var pad = s.cropMarks ? MARK_MARGIN_MM : 0;
		var inset = pad + s.bleedMm;
		return el('div', {
			class: 'mm-cut-line',
			style:
				'left:' + inset + 'mm;top:' + inset + 'mm;' +
				'width:' + s.cardWidthMm + 'mm;height:' + s.cardHeightMm + 'mm;' +
				'border-color:' + color + ';'
		});
	};

	MichiApp.prototype.print = function () {
		if (!this.image) {
			return;
		}
		var s = this.state;
		this.printRoot.innerHTML = '';

		var pad = s.cropMarks ? MARK_MARGIN_MM : 0;
		var tileOuterW = s.cardWidthMm + 2 * s.bleedMm + 2 * pad;
		var tileOuterH = s.cardHeightMm + 2 * s.bleedMm + 2 * pad;
		var markColor = this.markColorHex();

		// Row-major order so printed tiles read like the original image.
		for (var row = 0; row < s.rows; row++) {
			for (var col = 0; col < s.cols; col++) {
				var canvas = this.renderTileCanvas(col, row);
				var img = canvas; // canvas prints fine directly
				img.className = 'mm-tile-canvas';
				img.style.width = (s.cardWidthMm + 2 * s.bleedMm) + 'mm';
				img.style.height = (s.cardHeightMm + 2 * s.bleedMm) + 'mm';
				img.style.left = pad + 'mm';
				img.style.top = pad + 'mm';

				// Always draw the cut line (where to cut); crop ticks are optional.
				var children = [img, this.buildCutLine(markColor)];
				if (s.cropMarks) {
					children = children.concat(this.buildCropMarks(markColor));
				}

				var tile = el('div', {
					class: 'mm-tile',
					style: 'width:' + tileOuterW + 'mm;height:' + tileOuterH + 'mm;'
				}, children);

				this.printRoot.appendChild(tile);
			}
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
