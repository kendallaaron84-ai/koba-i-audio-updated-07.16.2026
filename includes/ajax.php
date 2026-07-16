<?php
/**
 * KOBA-I Audio: Data Handler
 * * Updates Post Status (Publish/Draft) & Syncs Vault.
 */
if ( ! defined( 'ABSPATH' ) ) exit;

add_action('wp_ajax_koba_save_studio_data', 'koba_handle_studio_save');

function koba_handle_studio_save() {
    check_ajax_referer('k_studio_nonce', 'nonce');
    if (!current_user_can('edit_posts')) wp_send_json_error('Permission denied');

    $post_id = intval($_POST['post_id']);
    
    // NEW: HANDLE STATUS (Live vs Draft)
    $status = isset($_POST['status']) ? sanitize_key($_POST['status']) : 'draft';
    
    // Update Core Post Data
    $post_data = [
        'ID' => $post_id,
        'post_title' => sanitize_text_field($_POST['title']),
        'post_status' => $status
    ];
    wp_update_post($post_data);

    // Update Metadata
    update_post_meta($post_id, '_koba_author_name', sanitize_text_field($_POST['author']));
    update_post_meta($post_id, '_koba_cover_art_url', esc_url_raw($_POST['cover']));
    update_post_meta($post_id, '_koba_bg_image_url', esc_url_raw($_POST['bg_image']));

    // Merge Logic (Preserves AI Data)
    $existing_json = get_post_meta($post_id, '_koba_chapters_data', true);
    $existing_chapters = koba_get_chapters_from_json($existing_json);
    
    $existing_map = [];
    foreach($existing_chapters as $ec) {
        $existing_map[$ec['id']] = $ec;
    }

    $raw_chapters = json_decode(stripslashes($_POST['chapters']), true);
    $clean_chapters = [];

    if (is_array($raw_chapters)) {
        foreach ($raw_chapters as $chap) {
            $id = sanitize_key($chap['id']);
            $new_chap = [
                'id'            => $id,
                'title'         => sanitize_text_field($chap['title']),
                'type'          => sanitize_key($chap['type']),
                'attachment_id' => intval($chap['attachment_id']),
                'ai_status'     => sanitize_key($chap['ai_status'])
            ];

            // Restore Critical AI Fields
            if (isset($existing_map[$id]['transcript_file_url'])) $new_chap['transcript_file_url'] = $existing_map[$id]['transcript_file_url'];
            if (isset($existing_map[$id]['transcript_json'])) $new_chap['transcript_json'] = $existing_map[$id]['transcript_json'];
            if (isset($existing_map[$id]['ai_op_name'])) $new_chap['ai_op_name'] = $existing_map[$id]['ai_op_name'];
            if (isset($existing_map[$id]['ai_source_name'])) $new_chap['ai_source_name'] = $existing_map[$id]['ai_source_name'];

            $clean_chapters[] = $new_chap;
        }
    }
    
    update_post_meta($post_id, '_koba_chapters_data', json_encode($clean_chapters));
    wp_send_json_success('Vault Synced');
}