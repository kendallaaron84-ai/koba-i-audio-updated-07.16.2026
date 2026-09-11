<?php
/**
 * KOBA-I Audio: Streaming Engine & Inbound Provisioning API
 * * Serves Audio/Video by ID. Hides real path. Supports Headless Mobile App.
 * * Adds Sovereign Inbound Provisioning API for Cloud Run Orchestration.
 */

if (!defined('ABSPATH')) exit;

// --- REGISTRATION CORNER ---
add_action('rest_api_init', function () {
    // Phase 5F retired the public reader stream route. Protected playback now
    // flows only through the canonical dashboard media manifest.
    // 2. 🚀 Sovereign Inbound Provisioning Engine (VPC Whitelisted Outbound Security)
    register_rest_route('koba-ia/v2', '/provision', [
        'methods'             => 'POST',
        'callback'            => 'koba_handle_remote_provisioning',
        'permission_callback' => 'koba_verify_hub_security_handshake',
    ]);
});

/**
 * REST Authentication Gatekeeper
 */
function koba_verify_hub_security_handshake(WP_REST_Request $request) {
    $provided_key = $request->get_header('X-Studio-Key');
    
    // Fallback profile check or explicit database lookups
    $stored_key = get_option('koba_master_studio_key', 'KOBA-AUDIO-E63DC9CA');
    
    if (empty($provided_key) || $provided_key !== $stored_key) {
        return new WP_Error(
            'rest_forbidden', 
            __('Invalid security handshake signature mapping.', 'koba-i-audio'), 
            ['status' => 401]
        );
    }
    return true;
}

/**
 * Execution Node: Programmatically Provisions Pages and Custom Post Types
 */
function koba_handle_remote_provisioning(WP_REST_Request $request) {
    $params = $request->get_json_params();
    $title  = sanitize_text_field($params['bookTitle']);
    $slug   = sanitize_key($params['canonicalSeoKey']);
    $status = sanitize_key($params['status']) === 'published' ? 'publish' : 'draft';
    $author_email = sanitize_email($params['authorEmail']);
    
    if (empty($title) || empty($slug)) {
        return new WP_REST_Response(['success' => false, 'message' => 'Missing parameter data payload.'], 400);
    }

    // ➔ TASK A: AUTOMATICALLY DEPLOY OR HEAL THE MAIN LIBRARY BOOKSHELF PAGE
    $bookshelf_page = get_page_by_path('bookshelf', OBJECT, 'page');
    if (!$bookshelf_page) {
        wp_insert_post([
            'post_title'   => 'Audiobook Shelf',
            'post_name'    => 'bookshelf',
            'post_status'  => 'publish',
            'post_type'    => 'page',
            'post_content' => '<!-- Jubilee Matrix Catalog Anchor Node -->[koba_window]'
        ]);
    }

    // ➔ TASK B: PROVISION OR UPDATE THE SPECIFIC CANONICAL IMMERSIVE WORK ASSET
    global $wpdb;
    $existing_post_id = $wpdb->get_var($wpdb->prepare(
        "SELECT ID FROM $wpdb->posts WHERE post_name = %s AND post_type = 'koba_publication' LIMIT 1",
        $slug
    ));

    $post_data = [
        'post_title'  => $title,
        'post_name'   => $slug,
        'post_status' => $status,
        'post_type'   => 'koba_publication'
    ];

    if ($existing_post_id) {
        $post_data['ID'] = $existing_post_id;
        wp_update_post($post_data);
        $post_id = $existing_post_id;
        $message = "Sovereign canvas layout updated successfully.";
    } else {
        $post_id = wp_insert_post($post_data);
        $message = "Sovereign canvas layout provisioned cleanly.";
    }

    // 3. PERSIST RAW ASSET METADATA METRIC PROPERTIES
    update_post_meta($post_id, '_koba_associated_asset_key', $slug);
    if (!empty($params['coverUrl'])) update_post_meta($post_id, '_koba_cover_art_url', esc_url_raw($params['coverUrl']));
    if (!empty($params['bgImageUrl'])) update_post_meta($post_id, '_koba_bg_image_url', esc_url_raw($params['bgImageUrl']));
    if (!empty($params['studioTracks'])) update_post_meta($post_id, '_koba_chapters_data', json_encode($params['studioTracks']));

    return new WP_REST_Response([
        'success' => true,
        'message' => $message,
        'wp_post_id' => $post_id,
        'canonical_url' => get_permalink($post_id)
    ], 200);
}

/**
 * Ghost Protocol Streaming Core Handler
 */
function koba_secure_stream($data) {
    $chapter_id = $data['id'];
    
    global $wpdb;
    $result = $wpdb->get_row("SELECT post_id, meta_value FROM $wpdb->postmeta WHERE meta_key = '_koba_chapters_data' AND meta_value LIKE '%$chapter_id%' LIMIT 1");

    if (!$result) return new WP_Error('not_found', 'Chapter not found', ['status' => 404]);

    $chapters = koba_get_chapters_from_json($result->meta_value);
    $target_chapter = null;
    foreach($chapters as $chap) {
        if (isset($chap['id']) && $chap['id'] == $chapter_id) {
            $target_chapter = $chap;
            break;
        }
    }

    if ($target_chapter && !empty($target_chapter['url'])) {
        $url = $target_chapter['url'];
        if (filter_var($url, FILTER_VALIDATE_URL)) {
            header("Location: " . $url, true, 302);
            exit;
        }
    }

    if (!$target_chapter || empty($target_chapter['attachment_id'])) {
        return new WP_Error('no_file', 'Media file missing from Vault', ['status' => 404]);
    }
    
    $file_path = get_attached_file($target_chapter['attachment_id']);
    if (!file_exists($file_path)) {
        if ($target_chapter && !empty($target_chapter['url']) && filter_var($target_chapter['url'], FILTER_VALIDATE_URL)) {
            header("Location: " . $target_chapter['url'], true, 302);
            exit;
        }
        return new WP_Error('missing', 'File deleted from server', ['status' => 404]);
    }

    $mime = ($target_chapter['type'] === 'video') ? 'video/mp4' : 'audio/mpeg';
    $size = filesize($file_path);
    $fp = fopen($file_path, 'rb');

    $start = 0;
    $end = $size - 1;

    header("Content-Type: $mime");
    header("Accept-Ranges: bytes");

    if (isset($_SERVER['HTTP_RANGE'])) {
        $range = $_SERVER['HTTP_RANGE'];
        $range = str_replace('bytes=', '', $range);
        list($start, $end) = explode('-', $range);
        if ($end == '') $end = $size - 1;
        
        header("HTTP/1.1 206 Partial Content");
        header("Content-Range: bytes $start-$end/$size");
        header("Content-Length: " . ($end - $start + 1));
        fseek($fp, $start);
    } else {
        header("Content-Length: $size");
    }

    while (!feof($fp) && ($p = ftell($fp)) <= $end) {
        if ($p + 8192 > $end) {
            echo fread($fp, $end - $p + 1);
        } else {
            echo fread($fp, 8192);
        }
        flush();
    }
    fclose($fp);
    exit;
}
