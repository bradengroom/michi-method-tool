<?php
/**
 * Plugin Name:       Michi Method Printer
 * Plugin URI:        https://example.com/michi-method
 * Description:        Embed a browser-based tool that slices an image into Pokemon-card-sized tiles across a binder-slot grid and prints them at exact physical size (the "michi method"). All processing happens in the visitor's browser; no images are uploaded to the server.
 * Version:           1.2.0
 * Requires at least: 5.8
 * Requires PHP:      7.2
 * Author:            Braden Groom
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       michi-method
 *
 * @package MichiMethod
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit; // Prevent direct access.
}

define( 'MICHI_METHOD_VERSION', '1.2.0' );
define( 'MICHI_METHOD_FILE', __FILE__ );
define( 'MICHI_METHOD_DIR', plugin_dir_path( __FILE__ ) );
define( 'MICHI_METHOD_URL', plugin_dir_url( __FILE__ ) );

/**
 * Register front-end assets. They are enqueued only when actually needed
 * (see michi_method_shortcode() and the block render), so unrelated pages
 * stay lean.
 */
function michi_method_register_assets() {
	wp_register_style(
		'michi-method',
		MICHI_METHOD_URL . 'assets/css/michi.css',
		array(),
		MICHI_METHOD_VERSION
	);

	wp_register_script(
		'michi-method',
		MICHI_METHOD_URL . 'assets/js/michi.js',
		array(),
		MICHI_METHOD_VERSION,
		true
	);
}
add_action( 'init', 'michi_method_register_assets' );

/**
 * Build the root container markup shared by the shortcode and the block.
 *
 * The JavaScript app bootstraps off `#michi-method-app` and reads all of its
 * defaults from the data-* attributes below, so the same markup works both
 * inside WordPress and in the standalone dev/index.html harness.
 *
 * @param array $atts Optional overrides for the data-* defaults.
 * @return string HTML markup.
 */
function michi_method_render_container( $atts = array() ) {
	$defaults = array(
		'cols'        => 3,
		'rows'        => 1,
		'card_width'  => 63,   // mm
		'card_height' => 88,   // mm
		'vgap'        => 2,    // mm, seam gap added to the width (between columns)
		'hgap'        => 2,    // mm, horizontal seam gap (between rows)
		'mark_color'  => 'black',
		'units'       => 'mm',
	);

	$atts = shortcode_atts( $defaults, $atts, 'michi_method' );

	return sprintf(
		'<div id="michi-method-app" class="michi-method"' .
			' data-default-cols="%1$s"' .
			' data-default-rows="%2$s"' .
			' data-card-width-mm="%3$s"' .
			' data-card-height-mm="%4$s"' .
			' data-vgap-mm="%5$s"' .
			' data-hgap-mm="%6$s"' .
			' data-mark-color="%7$s"' .
			' data-default-units="%8$s">' .
			'<noscript>%9$s</noscript>' .
		'</div>',
		esc_attr( $atts['cols'] ),
		esc_attr( $atts['rows'] ),
		esc_attr( $atts['card_width'] ),
		esc_attr( $atts['card_height'] ),
		esc_attr( $atts['vgap'] ),
		esc_attr( $atts['hgap'] ),
		esc_attr( $atts['mark_color'] ),
		esc_attr( $atts['units'] ),
		esc_html__( 'This tool requires JavaScript to be enabled in your browser.', 'michi-method' )
	);
}

/**
 * Shortcode handler: [michi_method].
 *
 * @param array $atts Shortcode attributes.
 * @return string
 */
function michi_method_shortcode( $atts ) {
	wp_enqueue_style( 'michi-method' );
	wp_enqueue_script( 'michi-method' );

	return michi_method_render_container( is_array( $atts ) ? $atts : array() );
}
add_shortcode( 'michi_method', 'michi_method_shortcode' );

/**
 * Register the Gutenberg block from blocks/block.json. The block reuses the
 * same render callback as the shortcode.
 */
function michi_method_register_block() {
	if ( ! function_exists( 'register_block_type' ) ) {
		return;
	}

	register_block_type(
		MICHI_METHOD_DIR . 'blocks',
		array(
			'render_callback' => 'michi_method_render_block',
		)
	);
}
add_action( 'init', 'michi_method_register_block' );

/**
 * Server-side render callback for the block.
 *
 * @param array $attributes Block attributes.
 * @return string
 */
function michi_method_render_block( $attributes ) {
	wp_enqueue_style( 'michi-method' );
	wp_enqueue_script( 'michi-method' );

	$atts = array();

	if ( isset( $attributes['cols'] ) ) {
		$atts['cols'] = absint( $attributes['cols'] );
	}
	if ( isset( $attributes['rows'] ) ) {
		$atts['rows'] = absint( $attributes['rows'] );
	}
	if ( isset( $attributes['cardWidth'] ) ) {
		$atts['card_width'] = floatval( $attributes['cardWidth'] );
	}
	if ( isset( $attributes['cardHeight'] ) ) {
		$atts['card_height'] = floatval( $attributes['cardHeight'] );
	}

	return michi_method_render_container( $atts );
}
