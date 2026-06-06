<?php
/**
 * Dependency manifest for the block editor script. Lets WordPress enqueue
 * blocks/index.js with the correct wp-* dependencies and in the right order
 * without a build step.
 *
 * @package MichiMethod
 */

return array(
	'dependencies' => array(
		'wp-blocks',
		'wp-element',
		'wp-block-editor',
		'wp-components',
		'wp-i18n',
	),
	'version'      => '1.0.0',
);
