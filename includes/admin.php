<?php
/**
 * KOBA-I Audio: Headless Gateway Admin
 * Status: Decoupled / Command Center Bridged
 */
if ( ! defined( 'ABSPATH' ) ) exit;

if (class_exists('Koba_Safety_Sentinel') && !Koba_Safety_Sentinel::scan()) return;

// 1. REGISTER THE LIGHTWEIGHT META BOX
add_action('add_meta_boxes', 'koba_headless_meta_boxes');
function koba_headless_meta_boxes() {
    add_meta_box(
        'koba_digital_id_box',
        'KOBA-I Command Center Link',
        'koba_render_headless_meta_box',
        'koba_publication', // Targets your existing Custom Post Type
        'normal',
        'high'
    );
}

// 2. RENDER THE META BOX (Only asks for Asset Key)
function koba_render_headless_meta_box($post) {
    wp_nonce_field('koba_save_meta', 'koba_meta_nonce');

    // We keep your exact meta key '_koba_asset_key' so existing data isn't lost!
    $asset_key = get_post_meta($post->ID, '_koba_asset_key', true);

    echo '<div style="padding: 15px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; font-family: sans-serif;">';
    echo '<div style="display: flex; align-items: center; gap: 8px; margin-bottom: 10px;">';
    echo '<span style="background: #10b981; width: 10px; height: 10px; border-radius: 50%; display: inline-block;"></span>';
    echo '<strong style="color: #0f172a; font-size: 14px;">Next.js Command Center Linked</strong>';
    echo '</div>';
    echo '<p style="font-size: 13px; color: #64748b; margin-top: 0; margin-bottom: 15px; line-height: 1.5;">';
    echo 'This publication is operating in headless mode. Media ingestion, pricing, and security are managed in your KOBA-I Dashboard. Paste your generated Asset Key below to link this window.</p>';
    
    echo '<p style="margin-bottom:5px; color: #334155;"><strong>Asset Key (Digital Identifier):</strong></p>';
    echo '<input type="text" name="koba_asset_key" value="' . esc_attr($asset_key) . '" style="width: 100%; font-family: monospace; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px;" placeholder="e.g. asset_duncan_audio_01" />';
    echo '</div>';
}

// 3. SAVE THE ASSET KEY
add_action('save_post', 'koba_save_headless_meta');
function koba_save_headless_meta($post_id) {
    if (!isset($_POST['koba_meta_nonce']) || !wp_verify_nonce($_POST['koba_meta_nonce'], 'koba_save_meta')) return;
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    if (!current_user_can('edit_post', $post_id)) return;

    if (isset($_POST['koba_asset_key'])) {
        $sanitized_key = sanitize_text_field($_POST['koba_asset_key']);
        update_post_meta($post_id, '_koba_asset_key', $sanitized_key);
    }
}