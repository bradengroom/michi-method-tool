/**
 * Block editor registration for the Michi Method Printer block.
 *
 * No build step: this uses the wp.* globals that WordPress loads in the editor
 * (declared as dependencies in index.asset.php). The block is server-rendered
 * via the PHP render_callback, so save() returns null and the editor shows a
 * lightweight placeholder with a few settings.
 */
(function (blocks, element, blockEditor, components, i18n) {
	'use strict';

	var el = element.createElement;
	var __ = i18n.__;
	var InspectorControls = blockEditor.InspectorControls;
	var PanelBody = components.PanelBody;
	var RangeControl = components.RangeControl;

	blocks.registerBlockType('michi-method/printer', {
		edit: function (props) {
			var attrs = props.attributes;
			var setAttributes = props.setAttributes;
			var blockProps = blockEditor.useBlockProps ? blockEditor.useBlockProps() : {};

			var inspector = el(
				InspectorControls,
				{},
				el(
					PanelBody,
					{ title: __('Binder grid', 'michi-method'), initialOpen: true },
					el(RangeControl, {
						label: __('Columns', 'michi-method'),
						value: attrs.cols,
						min: 1,
						max: 12,
						onChange: function (value) {
							setAttributes({ cols: value || 1 });
						}
					}),
					el(RangeControl, {
						label: __('Rows', 'michi-method'),
						value: attrs.rows,
						min: 1,
						max: 12,
						onChange: function (value) {
							setAttributes({ rows: value || 1 });
						}
					})
				),
				el(
					PanelBody,
					{ title: __('Card size (mm)', 'michi-method'), initialOpen: false },
					el(RangeControl, {
						label: __('Card width (mm)', 'michi-method'),
						value: attrs.cardWidth,
						min: 20,
						max: 120,
						onChange: function (value) {
							setAttributes({ cardWidth: value || 63 });
						}
					}),
					el(RangeControl, {
						label: __('Card height (mm)', 'michi-method'),
						value: attrs.cardHeight,
						min: 20,
						max: 160,
						onChange: function (value) {
							setAttributes({ cardHeight: value || 88 });
						}
					})
				)
			);

			var placeholder = el(
				'div',
				{
					style: {
						border: '2px dashed #d8dbe0',
						borderRadius: '12px',
						padding: '24px',
						textAlign: 'center',
						background: '#fafbfc'
					}
				},
				el('strong', {}, __('Michi Method Printer', 'michi-method')),
				el(
					'p',
					{ style: { margin: '6px 0 0', color: '#6b7280' } },
					i18n.sprintf(
						/* translators: 1: columns, 2: rows */
						__('Grid: %1$d x %2$d slots. The interactive tool appears on the published page.', 'michi-method'),
						attrs.cols,
						attrs.rows
					)
				)
			);

			return el('div', blockProps, inspector, placeholder);
		},

		// Dynamic block: rendered server-side by PHP.
		save: function () {
			return null;
		}
	});
})(window.wp.blocks, window.wp.element, window.wp.blockEditor, window.wp.components, window.wp.i18n);
