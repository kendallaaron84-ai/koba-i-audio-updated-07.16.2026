<?php
/**
 * Jubilee Works: Sovereign Dynamic Library Engine
 */
if ( ! defined( 'ABSPATH' ) ) exit;

function koba_window_shortcode($atts) {
    // 1. SAFETY GATE: If inside the WordPress admin editor backend, return a clean placeholder
    if (is_admin() || (defined('REST_REQUEST') && REST_REQUEST)) {
        return '<div style="padding: 15px; border: 1px dashed #cbd5e1; color: #64748b; text-align: center;">⚙️ Jubilee Library Carousel View Window [koba_window]</div>';
    }

    // 2. LICENSE VALIDATION LOCK
    if (get_option('koba_license_status') !== 'active') {
        return '<div style="padding: 20px; background: #fee2e2; color: #991b1b; text-align: center;"><strong>Jubilee Studio Error:</strong> License not activated.</div>';
    }

    // 3. SECURE ATTRIBUTE PARSING: Allow manual override or auto-detect user email
    $current_user = wp_get_current_user();
    $default_email = is_user_logged_in() ? $current_user->user_email : '';

    $parsed_atts = shortcode_atts([
        'author' => $default_email,
        'type'   => '', // Filter by audiobook or ebook if specified
    ], $atts, 'koba_window');

    $email = !empty($parsed_atts['author']) ? $parsed_atts['author'] : '';
    $product_type = !empty($parsed_atts['type']) ? $parsed_atts['type'] : '';

    // 🚀 AUTONOMOUS ENQUEUES: Serving assets locally from the WordPress plugin directory
    wp_enqueue_style('koba-bloom-css', KOBA_IA_URL . 'assets/bloom-style.css', [], '4.1.0');
    wp_enqueue_script('jubilee-core-js', KOBA_IA_URL . 'assets/jubilee-core.js', [], '4.1.0', true);

    // 📦 Inject Configuration Environment Bridges targeting the library-manifest
    $output = '<script>';
    $output .= 'window.currentJubileeUserEmail = "' . esc_js($email) . '";';
    // Forced absolute handshake path to our newly consolidated manifest router
    $output .= 'window.JubileeConfig = {';
    $output .= '    apiUrl: "http://localhost:3000/api/library/manifest",';
    $output .= '    checkoutUrl: "http://localhost:3000/api/checkout"';
    $output .= '};';
    $output .= 'console.log("🎯 Autonomous Library Engine active for author context: " + window.currentJubileeUserEmail);';
    $output .= '</script>';

    // Render the Target Mounting Node for jubilee-core.js
    $output .= '<div id="jubilee-catalog-root" data-author="' . esc_attr($email) . '" data-type="' . esc_attr($product_type) . '" style="min-height: 500px; width: 100%; margin-top:20px;">';
    $output .= '    <div style="color: #94a3b8; text-align:center; padding:50px; font-family:system-ui, sans-serif;">Connecting to Jubilee Command Center Vault...</div>';
    $output .= '</div>';

    return $output;
}
add_shortcode('koba_window', 'koba_window_shortcode');