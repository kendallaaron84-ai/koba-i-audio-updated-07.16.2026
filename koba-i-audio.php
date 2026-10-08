<?php
/**
 * Plugin Name: KOBA-I Audio - Jubilee Edition
 * Version: 6.2.0
 * Description: Version 6.2.0: Isolated illustrated-page presentation plus illustrated reflowable EPUB support.
 * Author: Kendall Aaron
 * Text Domain: Jubilee Works
 */

// Prevent direct access to the file
if ( ! defined( 'ABSPATH' ) ) {
    exit; 
}

/*
 * -----------------------------------------------------------------------------
 * AUTO-UPDATER INTEGRATION
 * -----------------------------------------------------------------------------
 */
require_once plugin_dir_path( __FILE__ ) . 'includes/updater.php';
if ( class_exists( 'KobaAudioUpdater' ) ) {
    $updater = new KobaAudioUpdater( __FILE__ );
    $updater->set_username( 'koba-i' );
    $updater->set_repository( 'https://audio.koba-i.com/updates/info.json' );
    $updater->initialize();
}

// 1. CONSTANTS
define( 'KOBA_IA_VERSION', '6.2.0' );
define( 'KOBA_IA_PATH', plugin_dir_path( __FILE__ ) );
define( 'KOBA_IA_URL', plugin_dir_url( __FILE__ ) );

if (!function_exists('koba_get_chapters_from_json')) {
    function koba_get_chapters_from_json($chapters_json) {
        if (empty($chapters_json)) {
            return [];
        }
        if (is_array($chapters_json)) {
            $raw_data = $chapters_json;
        } else {
            $raw_data = json_decode($chapters_json, true);
        }
        if (!is_array($raw_data)) {
            return [];
        }
        if (isset($raw_data['ebookPayload']['chapters'])) {
            return $raw_data['ebookPayload']['chapters'];
        }
        if (isset($raw_data['ebookPayload']) && is_array($raw_data['ebookPayload'])) {
            return $raw_data['ebookPayload']['chapters'] ?? $raw_data['ebookPayload'];
        }
        if (isset($raw_data['chapters'])) {
            return $raw_data['chapters'];
        }
        if (isset($raw_data['studioTracks'])) {
            return $raw_data['studioTracks'];
        }
        $first_item = reset($raw_data);
        if (is_array($first_item) && (isset($first_item['id']) || isset($first_item['title']) || isset($first_item['url']))) {
            return $raw_data;
        }
        return [];
    }
}

// 2. LOAD DEPENDENCIES
if ( file_exists( KOBA_IA_PATH . 'vendor/autoload.php' ) ) {
    require_once KOBA_IA_PATH . 'vendor/autoload.php';
}

$modules = [
    'includes/safety-sentinel.php',
    'includes/ai-engine.php',
    'includes/ai-processor.php',
    'includes/streaming.php',
    'includes/ajax.php',
    'includes/admin.php',
    'includes/security.php',
    'includes/gateway-security.php',
    'includes/shortcodes-v2.php', 
    'includes/updater.php',
];
foreach ($modules as $module) {
    if ( file_exists( KOBA_IA_PATH . $module ) ) require_once KOBA_IA_PATH . $module;
}

// Capture license submissions safely
add_action('admin_post_koba_activate_license', 'koba_handle_license_submit');
function koba_handle_license_submit() {
    if (!current_user_can('manage_options')) {
        wp_die('Unauthorized user context.');
    }

    check_admin_referer('koba_activate_license', 'koba_license_nonce');

    $new_key = isset($_POST['koba_key'])
        ? strtoupper(trim(sanitize_text_field(wp_unslash($_POST['koba_key']))))
        : '';

    // Production has issued both 8- and 16-hex-character KOBA-I StudioKeys.
    // Keep this validation aligned with /api/verify-license; the API remains the
    // authority and this client-side boundary must not reject an existing key.
    if (!preg_match('/^KOBA-AUDIO-(?:[A-F0-9]{8}|[A-F0-9]{16})$/', $new_key)) {
        update_option('koba_license_status', 'inactive');
        update_option('koba_license_last_error_code', 'PLUGIN_LICENSE_NOT_FOUND');
        update_option('koba_license_last_error', 'Enter a valid KOBA-I StudioKey.');
        wp_safe_redirect(admin_url('admin.php?page=koba-license&license_error=invalid_key'));
        exit;
    }

    $response = koba_request_storefront_site_identity($new_key);

    if (is_wp_error($response)) {
        update_option('koba_license_status', 'inactive');
        update_option('koba_license_last_error_code', 'PLUGIN_VERIFICATION_UNAVAILABLE');
        update_option('koba_license_last_error', $response->get_error_message());
        wp_safe_redirect(admin_url('admin.php?page=koba-license&license_error=connection'));
        exit;
    }

    $status_code = wp_remote_retrieve_response_code($response);
    $payload = json_decode(wp_remote_retrieve_body($response), true);
    if ($status_code !== 200 || !is_array($payload) || empty($payload['authorized'])) {
        $safe_code = is_array($payload) && isset($payload['code'])
            ? strtoupper(sanitize_key((string) $payload['code']))
            : 'PLUGIN_VERIFICATION_UNAVAILABLE';
        if (!preg_match('/^[A-Z][A-Z0-9_]{2,80}$/', $safe_code)) {
            $safe_code = 'PLUGIN_VERIFICATION_UNAVAILABLE';
        }
        update_option('koba_license_status', 'inactive');
        update_option('koba_license_last_error_code', $safe_code);
        update_option(
            'koba_license_last_error',
            is_array($payload) && !empty($payload['error'])
                ? sanitize_text_field($payload['error'])
                : 'StudioKey verification failed.'
        );
        wp_safe_redirect(admin_url('admin.php?page=koba-license&license_error=rejected'));
        exit;
    }

    update_option('koba_license_key', $new_key);
    update_option('koba_license_status', 'active');
    update_option('koba_storefront_site_token', sanitize_text_field($payload['storefrontSiteToken'] ?? ''));
    update_option('koba_website_connection_id', sanitize_text_field($payload['websiteConnectionId'] ?? ''));
    update_option('koba_website_content_role', sanitize_key($payload['role'] ?? ''));
    update_option('koba_license_capabilities', isset($payload['entitlements']) && is_array($payload['entitlements']) ? array_map('sanitize_text_field', $payload['entitlements']) : array());
    update_option('koba_license_associated_website', esc_url_raw($payload['associatedWebsite'] ?? home_url('/')));
    delete_option('koba_license_last_error');
    delete_option('koba_license_last_error_code');

    wp_safe_redirect(admin_url('admin.php?page=koba-license&success=true'));
    exit;
}

function koba_request_storefront_site_identity($studio_key) {
    $dashboard_url = rtrim(koba_get_dashboard_url(), '/');
    $verified_site_origin = esc_url_raw(
        get_option('koba_license_associated_website', home_url('/'))
    );
    return wp_remote_post($dashboard_url . '/api/verify-license', array(
        'timeout' => 20,
        'headers' => array(
            'Content-Type' => 'application/json',
            'X-Studio-Key' => $studio_key,
        ),
        'body' => wp_json_encode(array('domain' => $verified_site_origin)),
    ));
}

// 3. REGISTER POST TYPE
function koba_register_publication_post_type() {
    register_post_type('koba_publication', [
        'labels'      => ['name' => 'Publications', 'singular_name' => 'Publication', 'add_new_item' => 'Add New Audiobook'],
        'public'      => true, 
        'show_ui'     => true, 
        'show_in_menu' => true,
        'menu_icon'   => 'dashicons-album',
        'supports'    => ['title'],
        'show_in_rest' => true,
        'has_archive' => true,
        'rewrite'     => array('slug' => 'koba_publication', 'with_front' => false),
        'query_var'   => true
    ]);
}
add_action('init', 'koba_register_publication_post_type');

function koba_activate_audio_plugin() {
    koba_register_publication_post_type();
    flush_rewrite_rules(false);
    update_option('koba_publication_rewrite_schema', '1');
}
register_activation_hook(__FILE__, 'koba_activate_audio_plugin');

function koba_maybe_refresh_publication_rewrites() {
    if (get_option('koba_publication_rewrite_schema') === '1') {
        return;
    }

    flush_rewrite_rules(false);
    update_option('koba_publication_rewrite_schema', '1');
}
add_action('init', 'koba_maybe_refresh_publication_rewrites', 99);

/* =========================================================================
    🤖 AUTONOMOUS AGENT ENDPOINT: /wp-json/kobai/v1/publish-vault
========================================================================= */
add_action('rest_api_init', function () {
    register_rest_route('kobai/v1', '/storefront-catalog', [
        'methods'             => 'GET',
        'callback'            => 'koba_proxy_storefront_catalog',
        'permission_callback' => '__return_true',
    ]);
    register_rest_route('kobai/v1', '/publish-vault', [
        'methods'             => 'POST',
        'callback'            => 'koba_agent_create_vault_page',
        'permission_callback' => 'koba_authorize_gateway_publication_write'
    ]);
    register_rest_route('kobai/v1', '/update-chapter-audio', [
        'methods'             => 'POST',
        'callback'            => 'koba_agent_create_vault_page',
        'permission_callback' => 'koba_authorize_gateway_publication_write'
    ]);
});

function koba_agent_create_vault_page($request) {
    $params = $request->get_json_params();
    
    $asset_key   = sanitize_text_field($params['assetKey'] ?? ($params['asset_key'] ?? ''));
    $author_slug = sanitize_text_field($params['authorSlug'] ?? ($params['author_slug'] ?? 'global'));
    $book_title  = sanitize_text_field($params['bookTitle'] ?? ($params['book_title'] ?? 'Audiobook Vault'));
    $book_slug   = sanitize_title($params['bookSlug'] ?? ($params['book_slug'] ?? 'audiobook-vault'));
    
    $cover_art   = esc_url_raw($params['coverUrl'] ?? ($params['coverArt'] ?? ''));
    $bg_image    = esc_url_raw($params['bgImageUrl'] ?? ($params['bgImage'] ?? ''));
    $media_type  = sanitize_text_field($params['type'] ?? 'audio');
    $price       = sanitize_text_field($params['price'] ?? '0.00');
    $publication_status = sanitize_key($params['status'] ?? 'published');
    $expected_publication_id = absint($params['expectedPublicationId'] ?? 0);
    $expected_page_id = absint($params['expectedPageId'] ?? 0);

    if (!in_array($publication_status, array('draft', 'ready', 'published'), true)) {
        return new WP_Error(
            'invalid_publication_status',
            'The publication status is invalid.',
            array('status' => 400)
        );
    }
    $wordpress_post_status = $publication_status === 'published' ? 'publish' : 'draft';
    
    if (empty($params['chapters'])) {
        if (!empty($params['studioTracks'])) {
            $params['chapters'] = $params['studioTracks'];
        } elseif (!empty($params['ebookPayload']['chapters'])) {
            $params['chapters'] = $params['ebookPayload']['chapters'];
        } elseif (!empty($params['ebookPayload']) && is_array($params['ebookPayload'])) {
            $params['chapters'] = $params['ebookPayload'];
        }
    }

    $ebook_data = '';
    if (!empty($params['chapters']) && is_array($params['chapters'])) {
        $final_playlist = [];
        foreach ($params['chapters'] as $index => $ch) {
            $track_url = $ch['url'] ?? ($ch['audioUrl'] ?? ($ch['streamUrl'] ?? ($ch['src'] ?? '')));
            $chapter_text = $ch['textContent'] ?? ($ch['content'] ?? ($ch['text'] ?? ''));

            $final_playlist[] = [
                'id'          => !empty($ch['id']) ? sanitize_text_field($ch['id']) : 'ch_' . ($index + 1),
                'title'       => !empty($ch['title']) ? sanitize_text_field($ch['title']) : 'Chapter ' . ($index + 1),
                'url'         => esc_url_raw($track_url),
                'src'         => esc_url_raw($track_url),
                'audioUrl'    => esc_url_raw($track_url),
                'textContent' => wp_kses_post($chapter_text), 
                'type'        => sanitize_text_field($ch['type'] ?? 'text')
            ];
        }
        $ebook_data = json_encode($final_playlist);
    }

    if (empty($asset_key)) {
        return new WP_Error('missing_data', 'Missing assetKey identifier.', array('status' => 400));
    }

    $pub_id = koba_resolve_existing_publication_post(
        $expected_publication_id,
        $asset_key,
        'koba_publication',
        $book_slug
    );
    if (is_wp_error($pub_id)) {
        return $pub_id;
    }
    $pub_data = array(
        'post_title'  => $book_title,
        'post_status' => $wordpress_post_status,
        'post_type'   => 'koba_publication',
        'post_name'   => $book_slug
    );

    if ($pub_id > 0) {
        $pub_data['ID'] = $pub_id;
        $pub_id = wp_update_post($pub_data, true);
    } else {
        $pub_id = wp_insert_post($pub_data, true);
    }
    if (is_wp_error($pub_id)) {
        return $pub_id;
    }

    update_post_meta($pub_id, 'koba_asset_key', $asset_key);
    update_post_meta($pub_id, 'assetKey', $asset_key);
    update_post_meta($pub_id, 'authorSlug', $author_slug);
    update_post_meta($pub_id, '_koba_cover_art_url', $cover_art);
    update_post_meta($pub_id, '_koba_bg_image_url', $bg_image);
    update_post_meta($pub_id, '_koba_media_type', $media_type);
    update_post_meta($pub_id, '_koba_price', $price);
    update_post_meta($pub_id, '_koba_publication_status', $publication_status);
    
    if (!empty($ebook_data)) {
        update_post_meta($pub_id, '_koba_chapters_data', $ebook_data);
    }

    $existing_page_id = koba_resolve_existing_publication_post(
        $expected_page_id,
        $asset_key,
        'page',
        $book_slug
    );
    if (is_wp_error($existing_page_id)) {
        return $existing_page_id;
    }
    $page_content = sprintf(
        '[koba_bloom_player asset="%s"]',
        esc_attr($asset_key)
    );

    $page_data = array(
        'post_title'   => $book_title,
        'post_content' => $page_content,
        'post_status'  => $wordpress_post_status,
        'post_type'    => 'page',
        'post_name'    => $book_slug
    );

    if ($existing_page_id > 0) {
        $page_data['ID'] = $existing_page_id;
        $page_id = wp_update_post($page_data, true);
    } else {
        $page_id = wp_insert_post($page_data, true);
    }
    if (is_wp_error($page_id)) {
        return $page_id;
    }

    update_post_meta($page_id, 'assetKey', $asset_key);
    update_post_meta($page_id, 'authorSlug', $author_slug);
    update_post_meta($page_id, '_koba_cover_art_url', $cover_art);
    update_post_meta($page_id, '_koba_bg_image_url', $bg_image);
    update_post_meta($page_id, '_koba_media_type', $media_type);
    update_post_meta($page_id, '_koba_price', $price);
    update_post_meta($page_id, '_koba_publication_status', $publication_status);
    if (!empty($ebook_data)) {
        update_post_meta($page_id, '_koba_chapters_data', $ebook_data);
    }

    /*
     * Reuse the author's existing storefront when possible. Older installs
     * commonly used "bookstore", while current installs use "bookshelf".
     */
    $bookshelf_page = get_page_by_path('bookshelf', OBJECT, 'page');
    if (!$bookshelf_page) {
        $bookshelf_page = get_page_by_path('bookstore', OBJECT, 'page');
    }

    $bookshelf_page_id = $bookshelf_page ? (int) $bookshelf_page->ID : 0;

    if ($bookshelf_page_id <= 0) {
        $bookshelf_page_id = wp_insert_post(array(
            'post_title'   => 'Bookstore',
            'post_content' => '[koba_window]',
            'post_status'  => 'publish',
            'post_type'    => 'page',
            'post_name'    => 'bookshelf',
        ), true);

        if (is_wp_error($bookshelf_page_id)) {
            return $bookshelf_page_id;
        }

        $bookshelf_page_id = (int) $bookshelf_page_id;
    } else {
        $bookshelf_content = (string) $bookshelf_page->post_content;
        $has_catalog = has_shortcode($bookshelf_content, 'koba_window')
            || has_shortcode($bookshelf_content, 'jubilee_catalog');

        if (!$has_catalog) {
            $bookshelf_update = wp_update_post(array(
                'ID'           => $bookshelf_page_id,
                'post_content' => trim($bookshelf_content . "\n\n[koba_window]"),
            ), true);

            if (is_wp_error($bookshelf_update)) {
                return $bookshelf_update;
            }
        }
    }

    $bookshelf_url = get_permalink($bookshelf_page_id);
    if (!$bookshelf_url) {
        return new WP_Error(
            'bookshelf_url_missing',
            'The bookstore page was created, but its public URL could not be resolved.',
            array('status' => 500)
        );
    }

    return rest_ensure_response(array(
        'success'           => true,
        'url'               => home_url('/koba_publication/' . $book_slug . '/'),
        'page_id'           => $page_id,
        'publication_id'    => $pub_id,
        'bookshelf_page_id' => $bookshelf_page_id,
        'bookshelf_url'     => $bookshelf_url,
    ));
}

/* =========================================================================
    6. COMMAND CENTER SYNC ENGINE & ADMIN MANAGEMENT
========================================================================= */
if (!function_exists('koba_get_dashboard_url')) {
    function koba_get_dashboard_url() {
        if (defined('KOBA_DASHBOARD_URL')) {
            $configured_url = esc_url_raw((string) KOBA_DASHBOARD_URL);
            if (!empty($configured_url)) {
                return rtrim($configured_url, '/');
            }
        }

        return 'https://dashboard.koba-i.com';
    }
}

if (!function_exists('koba_get_authoritative_bookstore_url')) {
    function koba_get_authoritative_bookstore_url() {
        $storefront_page = get_page_by_path('bookshelf', OBJECT, 'page');
        if (!$storefront_page) {
            $storefront_page = get_page_by_path('bookstore', OBJECT, 'page');
        }

        if ($storefront_page) {
            $storefront_url = get_permalink((int) $storefront_page->ID);
            if ($storefront_url) {
                return $storefront_url;
            }
        }

        return home_url('/bookshelf/');
    }
}

add_action('rest_api_init', 'initialize_koba_studio_cors_policy', 5);
function initialize_koba_studio_cors_policy() {
    add_filter('rest_pre_serve_request', function($value, $result, $request) {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $has_studio_key = !empty($_SERVER['HTTP_X_STUDIO_KEY']) || !empty($_SERVER['HTTP_X_KOBAI_LICENSE_KEY']);
        
        if ($origin === 'https://dashboard.koba-i.com' || $origin === 'http://localhost:3000' || $origin === 'http://localhost:3002' || $has_studio_key) {
            header("Access-Control-Allow-Origin: " . ($origin ? $origin : "*"));
            header("Access-Control-Allow-Methods: GET, POST, OPTIONS");
            header("Access-Control-Allow-Credentials: true");
            header("Access-Control-Allow-Headers: Authorization, Content-Type, X-WP-Nonce, X-KOBAI-License-Key, X-Studio-Key");
            
            if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
                status_header(200);
                exit;
            }
        }
        return $value;
    }, 10, 3);
}

add_action('admin_menu', 'register_koba_audio_dashboard_links', 20);
function register_koba_audio_dashboard_links() {
    add_submenu_page('edit.php?post_type=koba_publication', 'Central Dashboard', '➡️ KOBA-I Dashboard', 'manage_options', 'https://dashboard.koba-i.com');
}

add_action('admin_menu', 'koba_register_license_page');
function koba_register_license_page() {
    add_menu_page(
        'Jubilee Studio License', 
        'Jubilee Activation', 
        'manage_options', 
        'koba-license', 
        'koba_render_license_page', 
        'dashicons-lock', 
        2
    );
}

function koba_render_license_page() {
    $status = get_option('koba_license_status', 'inactive');
    $current_key = get_option('koba_license_key', '');
    $domain = isset($_SERVER['HTTP_HOST']) ? $_SERVER['HTTP_HOST'] : 'localhost';

    echo '<div class="wrap" style="max-width: 500px; margin-top: 40px; background: #fff; padding: 30px; border-radius: 8px; box-shadow: 0 4px 6px rgba(0,0,0,0.1);">';
    echo '<h2>Jubilee Studio Activation</h2>';
    
    if ($status === 'active' && !empty($current_key)) {
        echo '<div style="background: #d1fae5; color: #065f46; padding: 15px; border-radius: 5px; margin-bottom: 20px;">✅ Jubilee Studio is securely locked to <strong>' . esc_html($domain) . '</strong> and fully active.</div>';
        echo '<p style="color: #666; font-size: 0.9rem;"><strong>Active Key:</strong> <code>' . esc_html($current_key) . '</code></p>';
        echo '<hr style="margin: 20px 0; border: 0; border-top: 1px solid #eee;" />';
        echo '<p style="font-size: 0.9rem; color: #666;">Need to update or change your license context?</p>';
    } else {
        echo '<p>Please enter your Jubilee Studio license key to activate the streaming engine.</p>';
    }

    echo '<form method="post" action="' . esc_url(admin_url('admin-post.php')) . '">';
    echo '<input type="hidden" name="action" value="koba_activate_license">';
    wp_nonce_field('koba_activate_license', 'koba_license_nonce');
    echo '<input type="text" name="koba_key" value="' . esc_attr($current_key) . '" placeholder="KOBA-AUDIO-XXXXXXXXXXXXXXXX" style="width: 100%; padding: 10px; margin-bottom: 15px; font-family: monospace;" required>';
    echo '<button type="submit" class="button button-primary button-large" style="width: 100%;">' . ($status === 'active' ? 'Update License Key' : 'Verify & Activate') . '</button>';
    echo '</form>';
    echo '</div>';
}

add_action('admin_notices', function() {
    if (isset($_GET['page']) && $_GET['page'] === 'koba-license' && isset($_GET['success']) && $_GET['success'] === 'true') {
        echo '<div class="notice notice-success is-dismissible"><p>🎉 Jubilee Studio activated successfully! Your domain is now securely locked.</p></div>';
    }
    if (isset($_GET['page']) && $_GET['page'] === 'koba-license' && isset($_GET['license_error'])) {
        $message = get_option('koba_license_last_error', 'StudioKey verification failed. Please check the key and try again.');
        $code = get_option('koba_license_last_error_code', 'PLUGIN_VERIFICATION_UNAVAILABLE');
        echo '<div class="notice notice-error is-dismissible"><p><strong>' . esc_html($code) . ':</strong> ' . esc_html($message) . '</p></div>';
    }
});

function koba_proxy_storefront_catalog($request) {
    $token = sanitize_text_field(get_option('koba_storefront_site_token', ''));
    $identity_refreshed = false;
    if ($token === '') {
        $refresh = koba_refresh_storefront_site_identity();
        if (is_wp_error($refresh)) {
            return koba_storefront_identity_refresh_error($refresh);
        }
        $token = $refresh;
        $identity_refreshed = true;
    }

    $query = array();
    $scope = sanitize_key($request->get_param('scope'));
    $type = sanitize_key($request->get_param('type'));
    $asset = sanitize_text_field($request->get_param('asset'));
    if (in_array($scope, array('tenant', 'global'), true)) $query['scope'] = $scope;
    if (in_array($type, array('audiobook', 'ebook', 'publication'), true)) $query['type'] = $type;
    if ($asset !== '') $query['asset'] = $asset;

    $url = add_query_arg($query, rtrim(koba_get_dashboard_url(), '/') . '/api/products/public');
    $response = koba_request_storefront_catalog($url, $token);
    if (is_wp_error($response)) {
        return new WP_REST_Response(array(
            'success' => false,
            'code' => 'STOREFRONT_CATALOG_UNAVAILABLE',
            'error' => 'The storefront catalog is temporarily unavailable.',
        ), 503);
    }
    $payload = json_decode(wp_remote_retrieve_body($response), true);

    if (
        !$identity_refreshed
        && wp_remote_retrieve_response_code($response) === 401
        && is_array($payload)
        && ($payload['code'] ?? '') === 'STOREFRONT_SITE_IDENTITY_INVALID'
    ) {
        $refresh = koba_refresh_storefront_site_identity();
        if (is_wp_error($refresh)) {
            return koba_storefront_identity_refresh_error($refresh);
        }

        $identity_refreshed = true;
        $response = koba_request_storefront_catalog($url, $refresh);
        if (is_wp_error($response)) {
            return koba_storefront_identity_refresh_error($response);
        }

        $payload = json_decode(wp_remote_retrieve_body($response), true);
        $retry_status = wp_remote_retrieve_response_code($response);
        if ($retry_status < 200 || $retry_status >= 300 || !is_array($payload)) {
            return koba_storefront_identity_refresh_error();
        }
    }

    if (!is_array($payload)) {
        $payload = array(
            'success' => false,
            'code' => 'STOREFRONT_CATALOG_INVALID_RESPONSE',
            'error' => 'The storefront returned an invalid response.',
        );
    }
    return new WP_REST_Response($payload, wp_remote_retrieve_response_code($response));
}

function koba_request_storefront_catalog($url, $token) {
    return wp_remote_get($url, array(
        'timeout' => 20,
        'headers' => array('Authorization' => 'Bearer ' . $token),
    ));
}

function koba_refresh_storefront_site_identity() {
    $studio_key = sanitize_text_field(get_option('koba_license_key', ''));
    if ($studio_key === '') {
        return new WP_Error(
            'STOREFRONT_SITE_IDENTITY_REQUIRED',
            'KOBA-I Audio must be activated before the bookstore can load.'
        );
    }

    $verification = koba_request_storefront_site_identity($studio_key);
    if (is_wp_error($verification)) {
        return $verification;
    }

    $verification_payload = json_decode(wp_remote_retrieve_body($verification), true);
    $verification_status = wp_remote_retrieve_response_code($verification);
    if (
        $verification_status !== 200
        || !is_array($verification_payload)
        || empty($verification_payload['storefrontSiteToken'])
    ) {
        return new WP_Error(
            'STOREFRONT_IDENTITY_REFRESH_FAILED',
            'The verified storefront identity could not be refreshed.'
        );
    }

    $token = sanitize_text_field($verification_payload['storefrontSiteToken']);
    update_option('koba_storefront_site_token', $token);
    update_option('koba_website_connection_id', sanitize_text_field($verification_payload['websiteConnectionId'] ?? ''));
    update_option('koba_website_content_role', sanitize_key($verification_payload['role'] ?? ''));
    return $token;
}

function koba_storefront_identity_refresh_error($error = null) {
    $status = $error instanceof WP_Error && $error->get_error_code() === 'STOREFRONT_SITE_IDENTITY_REQUIRED'
        ? 401
        : 503;
    $code = $status === 401
        ? 'STOREFRONT_SITE_IDENTITY_REQUIRED'
        : 'STOREFRONT_IDENTITY_REFRESH_FAILED';
    $message = $status === 401
        ? 'KOBA-I Audio must be activated before the bookstore can load.'
        : 'The verified storefront identity could not be refreshed.';

    return new WP_REST_Response(array(
        'success' => false,
        'code' => $code,
        'error' => $message,
    ), $status);
}

function koba_enforce_feature_capability($required_cap, $display_callback) {
    $status = get_option('koba_license_status', 'inactive');
    if ($status !== 'active') {
        echo '<div class="wrap"><div style="padding: 20px; background: #fee2e2; color: #991b1b; text-align: center; border-radius:6px; margin-top:20px;"><strong>Jubilee Error:</strong> Your plugin core is not activated.</div></div>';
        return;
    }
    if (is_callable($display_callback)) {
        call_user_func($display_callback);
    }
}

add_action('init', 'koba_enforce_license_lock');
function koba_enforce_license_lock() {
    if (get_option('koba_license_status') !== 'active') {
        remove_shortcode('jubilee_catalog');
        add_shortcode('jubilee_catalog', function() { return '<div style="padding: 20px; background: #fee2e2; color: #991b1b; text-align: center;"><strong>Jubilee Matrix Error:</strong> Associated parent platform is not activated.</div>'; });
    }
}

add_action(
    'wp_enqueue_scripts',
    'koba_load_vault_assets'
);

function koba_load_vault_assets() {
    wp_enqueue_style(
        'bloom-style',
        KOBA_IA_URL . 'assets/bloom-style.css',
        array(),
        filemtime(
            KOBA_IA_PATH .
            'assets/bloom-style.css'
        )
    );

    wp_enqueue_style(
        'koba-illustrated-pages',
        KOBA_IA_URL . 'assets/illustrated-pages.css',
        array('bloom-style'),
        filemtime(KOBA_IA_PATH . 'assets/illustrated-pages.css')
    );

    wp_enqueue_script(
        'koba-reader-handoff-js',
        KOBA_IA_URL . 'assets/reader-handoff.js',
        array(),
        filemtime(KOBA_IA_PATH . 'assets/reader-handoff.js'),
        true
    );

    wp_enqueue_script(
        'koba-illustrated-pages-js',
        KOBA_IA_URL . 'assets/illustrated-pages.js',
        array(),
        filemtime(KOBA_IA_PATH . 'assets/illustrated-pages.js'),
        true
    );

    wp_enqueue_script(
        'jubilee-core-js',
        KOBA_IA_URL . 'assets/jubilee-core.js',
        array('koba-reader-handoff-js'),
        filemtime(
            KOBA_IA_PATH .
            'assets/jubilee-core.js'
        ),
        true
    );

    wp_enqueue_script(
        'bloom-player-js',
        KOBA_IA_URL . 'assets/bloom-player.js',
        array('jubilee-core-js'),
        filemtime(
            KOBA_IA_PATH .
            'assets/bloom-player.js'
        ),
        true
    );

    $dashboard_url =
        koba_get_dashboard_url();
    $studio_key = sanitize_text_field(
        get_option('koba_license_key', '')
    );

    wp_localize_script(
        'koba-reader-handoff-js',
        'JubileeConfig',
        array(
            'dashboardUrl' =>
                $dashboard_url,

            'apiUrl' =>
                rest_url('kobai/v1/storefront-catalog'),

            'pluginUrl' =>
                KOBA_IA_URL,

            'logoUrl' =>
                KOBA_IA_URL .
                'assets/koba-logo-text-transparent.png',

            'readerUrl' =>
                koba_get_authoritative_bookstore_url(),

            'studioKey' =>
                $studio_key,
        )
    );
}

function koba_render_bloom_player_shortcode(
    $atts = array()
) {
    global $post;

    $atts = shortcode_atts(
        array(
            'asset' => '',
        ),
        $atts,
        'koba_bloom_player'
    );

    $book_id = $post ? (int) $post->ID : 0;

    $asset_key = sanitize_text_field(
        $atts['asset']
    );

    if ($asset_key === '' && $book_id > 0) {
        $asset_key =
            get_post_meta(
                $book_id,
                'koba_asset_key',
                true
            )
            ?: get_post_meta(
                $book_id,
                'assetKey',
                true
            )
            ?: '';
    }

    $asset_key = trim($asset_key);

    if ($asset_key === '') {
        return '
            <div style="
                color:#ef4444;
                padding:20px;
                text-align:center;
            ">
                Missing publication asset key.
            </div>
        ';
    }

    ob_start();

    koba_render_sovereign_player_engine(
        $book_id,
        $asset_key
    );

    return ob_get_clean();
}

function render_jubilee_matrix_buyer_catalog($atts) {
    $args = shortcode_atts(array('author' => '', 'type' => '', 'scope' => 'tenant'), $atts);
    $studio_key = sanitize_text_field(
        get_option('koba_license_key', '')
    );

    if ($studio_key === '') {
        return '<p role="alert" style="color:#ef4444; font-weight:bold;">KOBA-I Audio must be activated before the bookstore can load.</p>';
    }
    
    return sprintf(
        '<div id="jubilee-catalog-root" data-author="%s" data-studio-key="%s" data-type="%s" data-scope="%s" class="jubilee-matrix-loading">
            <div class="jubilee-spinner-wrapper" style="text-align:center; padding: 40px 0;">
                <div class="jubilee-spinner" style="display:inline-block; width:40px; height:40px; border:4px solid #333; border-top-color:#f97316; border-radius:50%%; animation: jSpin 1s linear infinite;"></div>
            </div>
         </div>
         <style>@keyframes jSpin { to { transform: rotate(360deg); } }</style>',
        esc_attr($args['author']),
        esc_attr($studio_key),
        esc_attr($args['type']),
        esc_attr($args['scope'] === 'global' ? 'global' : 'tenant')
    );
}

add_shortcode(
    'koba_window',
    'koba_render_window_shortcode'
);

function koba_render_window_shortcode($atts = array()) {
    $atts = shortcode_atts(
        array(
            'author' => '',
            'type'   => '',
            'scope'  => 'tenant',
        ),
        $atts,
        'koba_window'
    );

    return render_jubilee_matrix_buyer_catalog(
        array(
            'author' => sanitize_text_field(
                $atts['author']
            ),
            'type' => sanitize_text_field(
                $atts['type']
            ),
            'scope' => sanitize_key($atts['scope']),
        )
    );
}

add_filter('query_vars', 'koba_register_query_vars');
function koba_register_query_vars($vars) {
    $vars[] = 'asset';
    return $vars;
}

/**
 * Resolve a publication asset key across the canonical and legacy WordPress
 * metadata contracts. Existing installations have used several keys, while
 * newer publication URLs also use the asset key as the post slug.
 */
function koba_resolve_publication_asset_key($post_id, $provided_asset_key = '') {
    $asset_key = trim(
        sanitize_text_field(
            (string) $provided_asset_key
        )
    );

    if ($asset_key === '' && $post_id > 0) {
        $meta_keys = array(
            '_koba_asset_key',
            'koba_asset_key',
            '_koba_associated_asset_key',
            'assetKey',
        );

        foreach ($meta_keys as $meta_key) {
            $candidate = trim(
                (string) get_post_meta(
                    $post_id,
                    $meta_key,
                    true
                )
            );

            if ($candidate !== '') {
                $asset_key = $candidate;
                break;
            }
        }
    }

    if ($asset_key === '' && isset($_GET['asset'])) {
        $asset_key = trim(
            sanitize_text_field(
                wp_unslash($_GET['asset'])
            )
        );
    }

    if ($asset_key === '' && $post_id > 0) {
        $post = get_post($post_id);
        $post_slug = $post
            ? trim((string) $post->post_name)
            : '';

        if (
            strpos($post_slug, 'abk_') === 0
            || strpos($post_slug, 'aud_') === 0
            || strpos($post_slug, 'ebk_') === 0
        ) {
            $asset_key = $post_slug;
        }
    }

    return $asset_key;
}

/* =========================================================================
    🏗️ CORE ROUTING DISPATCHER: METADATA-BASED BRANCH SEGREGATION
========================================================================= */
function koba_render_sovereign_player_engine(
    $book_id,
    $resolved_asset_key = ''
) {
    $book_id = absint($book_id);
    $asset_key = koba_resolve_publication_asset_key(
        $book_id,
        $resolved_asset_key
    );

    if ($asset_key === '') {
        echo '
            <div style="
                color:#ef4444;
                padding:20px;
                text-align:center;
                font-family:system-ui,sans-serif;
            ">
                ⚠️ <strong>Sovereign Core Error:</strong>
                Missing publication asset key mapping assignment.
            </div>
        ';

        return;
    }

    $media_type = '';

    if ($book_id > 0) {
        $media_type = strtolower(
            trim(
                get_post_meta(
                    $book_id,
                    '_koba_media_type',
                    true
                )
            )
        );
    }

    /*
     * Prefix fallback is used only when metadata is unavailable,
     * such as the bookshelf query route.
     */
    if ($media_type === '') {
        $media_type = (
            str_starts_with($asset_key, 'abk_')
            || str_starts_with($asset_key, 'aud_')
        )
            ? 'audiobook'
            : 'ebook';
    }

    if (
        in_array(
            $media_type,
            array(
                'audio',
                'audiobook',
            ),
            true
        )
    ) {
        koba_render_bloom_player_ui(
            $book_id,
            $asset_key
        );

        return;
    }

    koba_render_sovereign_reader_engine(
        $book_id,
        $asset_key
    );
}

function koba_render_sovereign_player_engine_by_asset($asset_key, $post_id = 0) {
    $asset_key = trim($asset_key);
    if ($asset_key === '') return;

    $media_type = (strpos($asset_key, 'abk_') === 0 || strpos($asset_key, 'aud_') === 0) ? 'audiobook' : 'ebook';

    if ($media_type === 'audiobook') {
        koba_render_bloom_player_ui($post_id, $asset_key);
    } else {
        koba_render_sovereign_reader_engine($post_id, $asset_key);
    }
}

/* =========================================================================
    🎧 AUDIOBOOK BRANCH ENGINE: DOM MOUNT INITIALIZATION CONTAINER
========================================================================= */
function koba_render_bloom_player_ui($book_id, $asset_key = '') {
    // Structural parameter safety resolution fallback
    if (empty($asset_key) && !empty($book_id)) {
        $asset_key = get_post_meta($book_id, 'koba_asset_key', true) ?: get_post_meta($book_id, 'assetKey', true) ?: '';
    }
    $dashboard_url = koba_get_dashboard_url();
    $studio_key = get_option('koba_license_key', '');
    $is_paid_publication = ((float) get_post_meta($book_id, '_koba_price', true)) > 0;
    ?>
    <!-- 🎧 AUDIOBOOK COMPONENT MOUNT POINT -->
    <div 
        id="jubilee-bloom-root" 
        data-asset="<?php echo esc_attr($asset_key); ?>" 
        data-post-id="<?php echo esc_attr($book_id); ?>"
        data-studio-key="<?php echo esc_attr($studio_key); ?>"
        data-paid-publication="<?php echo $is_paid_publication ? 'true' : 'false'; ?>"
        data-api="<?php echo esc_url(rest_url('kobai/v1/storefront-catalog')); ?>"
        style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;"
    >
        <div id="koba-bloom-root" style="width:100%; height:100%;"></div>
    </div>
    <?php
}



/* =========================================================================
    📖 EBOOK BRANCH ENGINE: THE HIGH-PERFORMANCE GLASS READER
========================================================================= */
function koba_render_sovereign_reader_engine($post_id, $asset_key) {
    // Use the same authoritative dashboard origin as the canonical handoff.
    // A separate legacy API constant can point the e-reader at a different
    // deployment/Firebase project even after the handoff succeeds.
    $base_api_url = koba_get_dashboard_url();
    $token_url = rest_url('kobai/v1/reader-token');
    $wp_nonce = wp_create_nonce('wp_rest');
    $is_paid_publication = ((float) get_post_meta($post_id, '_koba_price', true)) > 0;
    ?>
    <div
        class="koba-reader-shell"
        style="
            width:100%;
            min-height:100vh;
            min-height:100svh;
            height:100dvh;
            box-sizing:border-box;
            overflow:hidden;
            display:flex;
            align-items:center;
            justify-content:center;
            background-color: #0f141c;
        "
    >
        <!-- 🎨 DYNAMIC RESPONSIVE STYLING GRIDS ENGINE -->
        <style>
            .koba-reader-shell {
                position: relative !important;
                isolation: isolate !important;
                padding: 24px 20px !important;
            }
            .koba-reader-mobile-header {
                display: none;
            }
            .koba-reader-stage {
                position: relative !important;
                z-index: 2 !important;
                width: 100% !important;
                height: 100% !important;
                display: grid !important;
                grid-template-rows: minmax(0, 1fr) auto auto !important;
                gap: 10px !important;
                justify-items: center;
                align-items: center;
            }
            .koba-reader-page {
                width: min(82vw, 920px) !important;
                min-height: 0 !important;
                height: 100% !important;
                background: var(--koba-page-color, #fffdf7);
                padding: clamp(24px, 4vw, 56px) !important;
                box-shadow: 0 24px 80px rgba(0,0,0,.45) !important;
                border-radius: 4px !important;
                box-sizing: border-box !important;
                overflow: hidden !important;
                transition: background 0.25s ease, color 0.25s ease !important;
                user-select: none !important;
                -webkit-user-select: none !important;
            }
            .koba-reader-paginated {
                width: 100% !important;
                height: 100% !important;
                min-height: 0 !important;
                overflow-x: auto !important;
                overflow-y: hidden !important;
                column-fill: auto !important;
                column-gap: 0 !important;
                scroll-behavior: smooth !important;
                scroll-snap-type: x mandatory !important;
                overscroll-behavior-x: contain !important;
                scrollbar-width: none !important;
                -ms-overflow-style: none !important;
                box-sizing: border-box !important;
            }
            .koba-reader-paginated::-webkit-scrollbar {
                display: none !important;
            }
            .koba-reader-copy {
                user-select: text !important;
                -webkit-user-select: text !important;
                cursor: text !important;
            }
            .koba-reader-highlight {
                background: rgba(250, 204, 21, 0.52) !important;
                color: inherit !important;
                border-radius: 2px !important;
                padding: 0 !important;
            }
            .koba-annotation-menu {
                position: fixed !important;
                z-index: 2147483646 !important;
                display: none;
                align-items: center;
                gap: 6px;
                padding: 6px;
                border: 1px solid rgba(255,255,255,.2);
                border-radius: 9px;
                background: rgba(15,20,28,.98);
                box-shadow: 0 16px 40px rgba(0,0,0,.4);
                font-family: system-ui, sans-serif;
            }
            .koba-annotation-menu button {
                border: 0;
                border-radius: 6px;
                padding: 8px 10px;
                background: #1f2937;
                color: #fff;
                font-size: 12px;
                font-weight: 700;
                cursor: pointer;
            }
            .koba-annotation-menu button:hover,
            .koba-annotation-menu button:focus-visible {
                background: #374151;
            }
            .koba-reader-backdrop {
                position: absolute !important;
                inset: -30px !important;
                z-index: 0 !important;
                background-image: 
                    linear-gradient(rgba(6, 10, 18, 0.58), rgba(6, 10, 18, 0.78)),
                    var(--koba-publication-background, none);
                background-size: cover !important;
                background-position: center !important;
                background-repeat: no-repeat !important;
                filter: blur(18px) saturate(1.1) !important;
                transform: scale(1.06) !important;
                opacity: 0;
                transition: opacity 300ms ease, filter 300ms ease !important;
                pointer-events: none !important;
            }
            .koba-reader-shell.is-fullscreen .koba-reader-backdrop {
                opacity: 1 !important;
            }
            
            /* 📱 SUBWAY COMPATIBLE RESPONSIVE VIEWPORT STACK OVERRIDES */
            @media (max-width: 767px) {
                .koba-reader-shell {
                    min-height: 100vh !important;
                    min-height: 100svh !important;
                    height: 100dvh !important;
                    padding: calc(62px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right)) calc(8px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left)) !important;
                }
                .koba-reader-mobile-header {
                    position: absolute;
                    z-index: 3;
                    top: env(safe-area-inset-top);
                    left: calc(112px + env(safe-area-inset-left));
                    right: calc(10px + env(safe-area-inset-right));
                    min-height: 58px;
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto;
                    align-items: center;
                    gap: 8px;
                    font-family: system-ui, sans-serif;
                    pointer-events: none;
                }
                .koba-reader-mobile-title {
                    overflow: hidden;
                    color: #fff;
                    font-size: 13px;
                    font-weight: 650;
                    text-align: center;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .koba-reader-mobile-brand {
                    color: #f9b437;
                    font-size: 12px;
                    font-weight: 800;
                    letter-spacing: .06em;
                }
                .koba-reader-stage {
                    grid-template-rows: minmax(0, 1fr) auto !important;
                    gap: 8px !important;
                }
                .koba-reader-page {
                    width: 100% !important;
                    padding: 18px !important;
                    border-radius: 4px !important;
                }
                .koba-reader-copy {
                    min-width: 0 !important;
                    font-size: max(16px, var(--koba-reader-size)) !important;
                    line-height: clamp(1.6, var(--koba-reader-leading), 1.75) !important;
                }
                .koba-reader-paginated {
                    touch-action: pan-y !important;
                    overflow-x: hidden !important;
                }
                .koba-reader-hud {
                    width: 100% !important;
                    grid-template-columns: minmax(44px, 1fr) auto auto minmax(44px, 1fr) !important;
                    grid-template-areas:
                        "previous progress progress next"
                        ". settings fullscreen ." !important;
                    gap: 6px 8px !important;
                    padding: 7px 8px calc(7px + env(safe-area-inset-bottom)) !important;
                    box-sizing: border-box !important;
                }
                .koba-reader-prev { grid-area: previous; }
                .koba-reader-progress { grid-area: progress; }
                .koba-reader-settings-button { grid-area: settings; }
                .koba-reader-fullscreen-button { grid-area: fullscreen; }
                .koba-reader-next { grid-area: next; }
                .koba-reader-prev,
                .koba-reader-next,
                .koba-reader-settings-button,
                .koba-reader-fullscreen-button {
                    min-width: 44px !important;
                    min-height: 44px !important;
                    padding: 8px !important;
                }
                .koba-reader-settings {
                    position: absolute !important;
                    z-index: 120 !important;
                    left: 0;
                    right: 0;
                    bottom: calc(104px + env(safe-area-inset-bottom));
                    width: 100% !important;
                    max-height: min(54dvh, 420px);
                    margin: 0 !important;
                    overflow-y: auto;
                    border-radius: 14px 14px 0 0 !important;
                }
                .koba-btn-text-long {
                    display: none !important;
                }
                .koba-btn-text-short {
                    display: inline !important;
                }
                .koba-secure-gateway-card {
                    width: 100% !important;
                    max-width: 100% !important;
                    padding: clamp(20px, 5vw, 32px) !important;
                    box-sizing: border-box !important;
                }
                article h3, article div {
                    width: 100% !important;
                    max-width: 100% !important;
                }
            }
            @media (min-width: 768px) {
                .koba-btn-text-short {
                    display: none !important;
                }
            }
            @media (min-width: 768px) and (max-width: 1023px) {
                .koba-reader-shell {
                    padding: calc(72px + env(safe-area-inset-top)) 24px calc(18px + env(safe-area-inset-bottom)) !important;
                }
                .koba-reader-mobile-header {
                    position: absolute;
                    top: env(safe-area-inset-top);
                    left: 180px;
                    right: 24px;
                    min-height: 64px;
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto;
                    align-items: center;
                    gap: 16px;
                    font-family: system-ui, sans-serif;
                    pointer-events: none;
                }
                .koba-reader-mobile-title { color:#fff; text-align:center; font-weight:700; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .koba-reader-mobile-brand { color:#f9b437; font-weight:800; }
                .koba-reader-page,
                .koba-reader-hud,
                .koba-reader-settings { width: min(100%, 820px) !important; }
            }
            @media (orientation: landscape) and (max-height: 600px) and (max-width: 1023px) {
                .koba-reader-shell::after {
                    content: "For the best reading view, rotate to portrait.";
                    position: absolute;
                    z-index: 4;
                    top: calc(8px + env(safe-area-inset-top));
                    right: calc(10px + env(safe-area-inset-right));
                    max-width: 230px;
                    color: #cbd5e1;
                    font: 600 11px/1.3 system-ui, sans-serif;
                    text-align: right;
                    pointer-events: none;
                }
                .koba-reader-mobile-header { display: none; }
            }
            @supports not (backdrop-filter: blur(1px)) {
                .koba-reader-backdrop { filter: none !important; }
                .koba-reader-shell.is-fullscreen .koba-reader-page,
                .koba-reader-shell.is-fullscreen .koba-reader-hud,
                .koba-reader-shell.is-fullscreen .koba-reader-settings {
                    backdrop-filter: none !important;
                    -webkit-backdrop-filter: none !important;
                }
            }
            .koba-reader-shell.is-fullscreen .koba-reader-page {
                background: var(--koba-page-color, #fffdf7) !important;
                background: color-mix(in srgb, var(--koba-page-color, #fffdf7) 90%, transparent) !important;
                border: 1px solid rgba(255, 255, 255, 0.28) !important;
                box-shadow: 0 30px 90px rgba(0, 0, 0, 0.42), inset 0 1px 0 rgba(255, 255, 255, 0.35) !important;
                backdrop-filter: blur(18px) saturate(1.08) !important;
                -webkit-backdrop-filter: blur(18px) saturate(1.08) !important;
            }
            .koba-reader-shell.is-fullscreen .koba-reader-page[data-reader-theme="dark"] {
                background: rgba(31, 41, 51, 0.95) !important;
            }
            .koba-reader-shell.is-fullscreen .koba-reader-hud,
            .koba-reader-shell.is-fullscreen .koba-reader-settings {
                background: rgba(15, 20, 28, 0.68) !important;
                border: 1px solid rgba(255, 255, 255, 0.15) !important;
                backdrop-filter: blur(20px) saturate(1.15) !important;
                -webkit-backdrop-filter: blur(20px) saturate(1.15) !important;
                box-shadow: 0 18px 50px rgba(0, 0, 0, 0.34) !important;
            }
        </style>

        <header class="koba-reader-mobile-header" aria-label="Publication header">
            <span class="koba-reader-mobile-title"><?php echo esc_html(get_the_title($post_id)); ?></span>
            <span class="koba-reader-mobile-brand">KOBA-I</span>
        </header>
        <div class="koba-reader-backdrop" aria-hidden="true"></div>

        <div class="koba-reader-stage">
            <main class="koba-reader-page">
                <div
                    id="koba-ebook-canvas-root"
                    data-asset="<?php echo esc_attr($asset_key); ?>"
                    data-studio-key="<?php echo esc_attr(get_option('koba_license_key', '')); ?>"
                    data-paid-publication="<?php echo $is_paid_publication ? 'true' : 'false'; ?>"
                    data-api="<?php echo esc_url($base_api_url . '/api/media/manifest'); ?>"
                    data-token-url="<?php echo esc_url($token_url); ?>"
                    data-nonce="<?php echo esc_attr($wp_nonce); ?>"
                    data-base-url="<?php echo esc_url($base_api_url); ?>"
                    style="width:100%; height:100%;"
                >
                    <div class="manuscript-text-container" style="width:100%; height:100%;">
                        <div style="color: #64748b; text-align: center; padding-top: 100px; font-family: system-ui, sans-serif;">
                            <span style="display:inline-block; animation: spin 1s linear infinite; margin-bottom:15px;">⏳</span><br>
                            🔬 DEVELOPMENT MODE: Connecting to dynamic manuscript node...
                        </div>
                    </div>
                </div>
            </main>
        </div>
    </div>

    <script>
    (function() {
        const root = document.querySelector("#koba-ebook-canvas-root");
        if (!root) return;

        const assetKey = root.dataset.asset;
        const apiUrl = root.dataset.api;
        const container = root.querySelector(".manuscript-text-container");
        const viewportCard = root.closest(".koba-reader-page");
        const stage = root.closest(".koba-reader-stage");
        const readerShell = root.closest(".koba-reader-shell");
        const baseUrl = (root.dataset.baseUrl || "").replace(/\/$/, "");
        const paidPublication = root.dataset.paidPublication === "true";

        if (!apiUrl || !baseUrl || !assetKey || !container || !viewportCard || !stage || !readerShell) return;

        const globalPrefKey = "koba_reader_preferences_v1";
        const progressKey = `koba_reader_progress_${assetKey}`;
        const annotationKey = `koba_reader_annotations_${assetKey}`;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        
        container.style.transition = reduceMotion ? "none" : "opacity 150ms ease";

        let readerPages = [];
        let currentIndex = 0;
        let currentVisualPage = 0;
        let currentVisualPageCount = 1;
        let isTransitioning = false;
        let hudIdleTimeout;
        let annotationSelection = null;
        let annotations = [];
        let illustratedBook = null;
        let illustratedGroupSignature = "";

        try {
            const savedAnnotations = JSON.parse(localStorage.getItem(annotationKey) || "[]");
            annotations = Array.isArray(savedAnnotations) ? savedAnnotations : [];
        } catch (error) {
            annotations = [];
        }

        async function waitForCanonicalHandoff() {
            if (!String(window.location.hash || "").startsWith("#koba_reader_handoff=")) return;
            const deadline = Date.now() + 5000;
            while (!window.KobaReaderHandoff && Date.now() < deadline) {
                await new Promise(resolve => window.setTimeout(resolve, 25));
            }
            if (!window.KobaReaderHandoff) throw new Error("The canonical reader handoff script did not load.");
        }

        async function requestAuthorizedPublication() {
            await waitForCanonicalHandoff();
            if (window.KobaReaderHandoff) await window.KobaReaderHandoff.ready;
            const canonicalSession = window.KobaReaderHandoff
                ? window.KobaReaderHandoff.sessionForAsset(assetKey, root.dataset.studioKey || "")
                : null;
            if (!canonicalSession) {
                const launcher = paidPublication ? '/reader/open' : '/reader/free';
                window.location.replace(`${baseUrl}${launcher}?assetId=${encodeURIComponent(assetKey)}`);
                return new Promise(() => {});
            }
            const readerToken = canonicalSession.globalReaderToken;

            const headers = readerToken
                ? { Authorization: `Bearer ${readerToken}` }
                : {};
            const response = await fetch(
                `${apiUrl}?asset=${encodeURIComponent(assetKey)}`,
                { headers }
            );
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                window.KobaReaderHandoff.clearTenant(
                    canonicalSession.tenantId,
                    canonicalSession.assetId,
                    canonicalSession.principalType
                );
                throw new Error(data?.error || "Canonical reader authorization was rejected.");
            }
            return data;
        }

        // 🏗️ HUD DOM CONSOLE ASSEMBLY
        const navTray = document.createElement("footer");
        navTray.classList.add("koba-reader-hud");
        navTray.style.cssText =
            "width:min(82vw, 920px); display:grid; grid-template-columns:1fr auto auto auto 1fr; " +
            "align-items:center; gap:14px; padding:10px 14px; box-sizing:border-box; " +
            "background:rgba(15,20,28,.92); border:1px solid #273244; border-radius:10px; " +
            "font-family:system-ui,sans-serif; box-shadow:0 10px 30px rgba(0,0,0,.25); flex-shrink:0; " +
            "opacity:1; transition: opacity 200ms ease-in-out; z-index:100;";

        const previousButton = document.createElement("button");
        previousButton.type = "button";
        previousButton.className = "koba-reader-prev";
        previousButton.innerHTML = '<span class="koba-btn-text-long">← Previous</span><span class="koba-btn-text-short">←</span>';
        previousButton.style.cssText = "background:#1f2937; color:#fff; border:1px solid #374151; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:500; font-size:14px; transition:opacity .2s; user-select:none; justify-self:start;";

        const pageIndicator = document.createElement("span");
        pageIndicator.className = "koba-reader-progress";
        pageIndicator.setAttribute("aria-live", "polite");
        pageIndicator.style.cssText = "color:#cbd5e1; font-size:13px; font-weight:500; text-align:center; user-select:none; justify-self:center; white-space:nowrap;";

        const settingsButton = document.createElement("button");
        settingsButton.type = "button";
        settingsButton.className = "koba-reader-settings-button";
        settingsButton.textContent = "Aa";
        settingsButton.setAttribute("aria-label", "Adjust composition styles");
        settingsButton.style.cssText = "background:#1f2937; color:#fff; border:1px solid #374151; width:42px; height:42px; border-radius:6px; cursor:pointer; font-size:16px; font-weight:700; justify-self:center;";

        const fullscreenButton = document.createElement("button");
        fullscreenButton.type = "button";
        fullscreenButton.className = "koba-reader-fullscreen-button";
        fullscreenButton.textContent = "⛶";
        fullscreenButton.setAttribute("aria-label", "Toggle fullscreen immersion");
        fullscreenButton.setAttribute("aria-pressed", "false");
        fullscreenButton.style.cssText = "background:#1f2937; color:#fff; border:1px solid #374151; width:42px; height:42px; border-radius:6px; cursor:pointer; font-size:16px; font-weight:700; justify-self:center;";

        const nextButton = document.createElement("button");
        nextButton.type = "button";
        nextButton.className = "koba-reader-next";
        nextButton.innerHTML = '<span class="koba-btn-text-long">Next →</span><span class="koba-btn-text-short">→</span>';
        nextButton.style.cssText = "background:#1f2937; color:#fff; border:1px solid #374151; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:500; font-size:14px; transition:opacity .2s; user-select:none; justify-self:end;";

        navTray.append(previousButton, pageIndicator, settingsButton, fullscreenButton, nextButton);

        const settingsPanel = document.createElement("div");
        settingsPanel.classList.add("koba-reader-settings");
        settingsPanel.hidden = true;
        settingsPanel.style.cssText = "width:min(82vw, 920px); box-sizing:border-box; padding:16px; display:grid; grid-template-columns:repeat(auto-fit, minmax(130px, 1fr)); gap:14px; background:rgba(15,20,28,.96); border:1px solid #273244; border-radius:10px; font-family:system-ui,sans-serif; color:#fff; margin-top:2px; box-shadow:0 8px 24px rgba(0,0,0,0.3); opacity:0; transition: opacity 200ms ease-in-out; z-index:90;";

        function createSettingGroup(labelText) {
            const group = document.createElement("label");
            group.style.cssText = "display:flex; flex-direction:column; gap:7px; font-size:12px; font-weight:700; letter-spacing:.04em; color:#cbd5e1;";
            const label = document.createElement("span"); label.textContent = labelText; group.appendChild(label);
            return group;
        }

        const selectStyle = "background:#1f2937; color:#fff; border:1px solid #374151; padding:8px; border-radius:4px; font-size:13px; outline:none; cursor:pointer;";

        const pageColorGroup = createSettingGroup("Page Theme");
        const pageColorSelect = document.createElement("select"); pageColorSelect.style.cssText = selectStyle;
        [["Warm", "#fffdf7"], ["White", "#ffffff"], ["Sepia", "#f4ecd8"], ["Dark", "#1f2933"]].forEach(([l, v]) => {
            const op = document.createElement("option"); op.textContent = l; op.value = v; pageColorSelect.appendChild(op);
        });
        pageColorGroup.appendChild(pageColorSelect);

        // 🎯 FIX: Re-instated typography selectors to prevent reference safety parameters crashes
        const fontGroup = createSettingGroup("Typography Font");
        const fontSelect = document.createElement("select"); fontSelect.style.cssText = selectStyle;
        [["Publisher Default", "inherit"], ["Atkinson Hyperlegible", '"Atkinson Hyperlegible", sans-serif'], ["Georgia Serif", "Georgia, serif"], ["System UI Sans", "system-ui, sans-serif"], ["OpenDyslexic Core", '"OpenDyslexic", sans-serif']].forEach(([l, v]) => {
            const op = document.createElement("option"); op.textContent = l; op.value = v; fontSelect.appendChild(op);
        });
        fontGroup.appendChild(fontSelect);

        const marginSelectGroup = createSettingGroup("Margin Canvas Bounds");
        const marginSelect = document.createElement("select"); marginSelect.style.cssText = selectStyle;
        [
            ["Narrow", "760px"],
            ["Medium", "680px"],
            ["Wide", "580px"]
        ].forEach(([label, value]) => {
            const option =
                document.createElement("option");

            option.textContent = label;
            option.value = value;

            marginSelect.appendChild(option);
        });

        const rangeStyle = "cursor:pointer; accent-color:#3b82f6; margin-top:4px;";
        const fontSizeGroup = createSettingGroup("Text Size");
        const fontSizeRange = document.createElement("input"); fontSizeRange.type = "range"; fontSizeRange.min = "14"; fontSizeRange.max = "26"; fontSizeRange.step = "1"; fontSizeRange.value = "18"; fontSizeRange.style.cssText = rangeStyle;
        fontSizeGroup.appendChild(fontSizeRange);

        const lineHeightGroup = createSettingGroup("Line Spacing");
        const lineHeightRange = document.createElement("input"); lineHeightRange.type = "range"; lineHeightRange.min = "1.4"; lineHeightRange.max = "2.4"; lineHeightRange.step = "0.1"; lineHeightRange.value = "1.9"; lineHeightRange.style.cssText = rangeStyle;
        lineHeightGroup.appendChild(lineHeightRange);

        const savedPlacesGroup = createSettingGroup("Saved Highlights & Bookmarks");
        savedPlacesGroup.style.gridColumn = "1 / -1";
        const savedPlacesList = document.createElement("div");
        savedPlacesList.style.cssText = "display:flex; gap:8px; overflow-x:auto; padding:2px 0 4px; scrollbar-width:thin;";
        savedPlacesGroup.appendChild(savedPlacesList);

        settingsPanel.append(pageColorGroup, fontGroup, fontSizeGroup, lineHeightGroup, marginSelectGroup, savedPlacesGroup);
        stage.append(navTray, settingsPanel);

        const annotationMenu = document.createElement("div");
        annotationMenu.className = "koba-annotation-menu";
        annotationMenu.setAttribute("role", "toolbar");
        annotationMenu.setAttribute("aria-label", "Reader annotation actions");
        const highlightButton = document.createElement("button");
        highlightButton.type = "button";
        highlightButton.textContent = "Highlight";
        const bookmarkButton = document.createElement("button");
        bookmarkButton.type = "button";
        bookmarkButton.textContent = "Save Bookmark";
        annotationMenu.append(highlightButton, bookmarkButton);
        readerShell.appendChild(annotationMenu);

        function hudHasFocus() {
            return (navTray.contains(document.activeElement) || settingsPanel.contains(document.activeElement));
        }

        function showHUD() {
            navTray.style.opacity = "1"; navTray.style.pointerEvents = "auto";
            if (!settingsPanel.hidden) { settingsPanel.style.opacity = "1"; settingsPanel.style.pointerEvents = "auto"; }
            resetHUDTimeout();
        }

        function hideHUD() {
            if (!settingsPanel.hidden || hudHasFocus()) return;
            navTray.style.opacity = "0"; navTray.style.pointerEvents = "none";
        }

        function resetHUDTimeout() {
            clearTimeout(hudIdleTimeout);
            if (settingsPanel.hidden && !hudHasFocus()) { hudIdleTimeout = setTimeout(hideHUD, 3000); }
        }

        function saveAnnotations() {
            localStorage.setItem(annotationKey, JSON.stringify(annotations));
            renderSavedPlaces();
        }

        function renderSavedPlaces() {
            savedPlacesList.replaceChildren();
            if (!annotations.length) {
                const empty = document.createElement("span");
                empty.textContent = "Select text while reading to save a highlight or bookmark.";
                empty.style.cssText = "color:#94a3b8; font-size:12px; font-weight:500; padding:6px 0;";
                savedPlacesList.appendChild(empty);
                return;
            }
            annotations.forEach(annotation => {
                const item = document.createElement("div");
                item.style.cssText = "display:flex; align-items:center; flex:0 0 auto; border:1px solid #374151; border-radius:7px; overflow:hidden; background:#1f2937;";
                const goButton = document.createElement("button");
                goButton.type = "button";
                const prefix = annotation.type === "highlight" ? "Highlight" : "Bookmark";
                const excerpt = String(annotation.quote || annotation.label || "Saved place").replace(/\s+/g, " ").trim();
                goButton.textContent = `${prefix}: ${excerpt.slice(0, 55)}${excerpt.length > 55 ? "…" : ""}`;
                goButton.style.cssText = "border:0; background:transparent; color:#e2e8f0; padding:8px 10px; max-width:260px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; cursor:pointer; text-align:left; font-size:11px; font-weight:600;";
                goButton.addEventListener("click", () => {
                    const destination = Number(annotation.sectionIndex);
                    if (!Number.isInteger(destination) || destination < 0 || destination >= readerPages.length) return;
                    currentIndex = destination;
                    currentVisualPage = Math.max(0, Number(annotation.visualPage) || 0);
                    renderPage();
                });
                const removeButton = document.createElement("button");
                removeButton.type = "button";
                removeButton.textContent = "×";
                removeButton.setAttribute("aria-label", `Remove ${prefix.toLowerCase()}`);
                removeButton.style.cssText = "border:0; border-left:1px solid #374151; background:transparent; color:#94a3b8; width:30px; align-self:stretch; cursor:pointer; font-size:16px;";
                removeButton.addEventListener("click", () => {
                    annotations = annotations.filter(itemValue => itemValue.id !== annotation.id);
                    applyHighlights(Number(annotation.sectionIndex));
                    saveAnnotations();
                    measureActivePagination();
                });
                item.append(goButton, removeButton);
                savedPlacesList.appendChild(item);
            });
        }

        function applyHighlights(sectionIndex) {
            const activeSection = readerPages[sectionIndex];
            const body = activeSection?.node?.querySelector?.(".koba-reader-copy");
            if (!body) return;
            const sourceText = body.dataset.sourceText || body.textContent || "";
            body.dataset.sourceText = sourceText;
            body.replaceChildren();

            const highlights = annotations
                .filter(item => item.type === "highlight" && Number(item.sectionIndex) === sectionIndex)
                .map(item => ({ ...item, start: Number(item.start), end: Number(item.end) }))
                .filter(item => Number.isInteger(item.start) && Number.isInteger(item.end) && item.start >= 0 && item.end > item.start && item.end <= sourceText.length)
                .sort((left, right) => left.start - right.start || left.end - right.end);

            let cursor = 0;
            highlights.forEach(highlight => {
                if (highlight.start < cursor) return;
                if (highlight.start > cursor) body.appendChild(document.createTextNode(sourceText.slice(cursor, highlight.start)));
                const mark = document.createElement("mark");
                mark.className = "koba-reader-highlight";
                mark.dataset.annotationId = highlight.id;
                mark.textContent = sourceText.slice(highlight.start, highlight.end);
                body.appendChild(mark);
                cursor = highlight.end;
            });
            if (cursor < sourceText.length) body.appendChild(document.createTextNode(sourceText.slice(cursor)));
        }

        function selectionOffset(body, node, offset) {
            const range = document.createRange();
            range.selectNodeContents(body);
            range.setEnd(node, offset);
            return range.toString().length;
        }

        function hideAnnotationMenu(clearSelection = false) {
            annotationMenu.style.display = "none";
            annotationSelection = null;
            if (clearSelection) window.getSelection()?.removeAllRanges();
        }

        function captureAnnotationSelection() {
            const selection = window.getSelection();
            if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
                hideAnnotationMenu(false);
                return;
            }
            const range = selection.getRangeAt(0);
            const body = range.startContainer.nodeType === Node.ELEMENT_NODE
                ? range.startContainer.closest?.(".koba-reader-copy")
                : range.startContainer.parentElement?.closest(".koba-reader-copy");
            if (!body || !container.contains(body) || !body.contains(range.endContainer)) {
                hideAnnotationMenu(false);
                return;
            }
            const start = selectionOffset(body, range.startContainer, range.startOffset);
            const end = selectionOffset(body, range.endContainer, range.endOffset);
            const normalizedStart = Math.min(start, end);
            const normalizedEnd = Math.max(start, end);
            const quote = selection.toString().replace(/\s+/g, " ").trim();
            if (!quote || normalizedEnd <= normalizedStart) {
                hideAnnotationMenu(false);
                return;
            }
            annotationSelection = {
                sectionIndex: currentIndex,
                visualPage: currentVisualPage,
                start: normalizedStart,
                end: normalizedEnd,
                quote,
            };
            const rect = range.getBoundingClientRect();
            const left = Math.max(8, Math.min(window.innerWidth - 230, rect.left + (rect.width / 2) - 105));
            const top = Math.max(8, rect.top - 52);
            annotationMenu.style.left = `${left}px`;
            annotationMenu.style.top = `${top}px`;
            annotationMenu.style.display = "flex";
        }

        function commitAnnotation(type) {
            if (!annotationSelection) return;
            const selectionData = annotationSelection;
            const id = window.crypto?.randomUUID?.() || `annotation_${Date.now()}_${Math.random().toString(36).slice(2)}`;
            annotations.push({
                id,
                type,
                ...selectionData,
                label: readerPages[currentIndex]?.label || "Saved place",
                createdAt: new Date().toISOString(),
            });
            applyHighlights(currentIndex);
            saveAnnotations();
            hideAnnotationMenu(true);
            measureActivePagination();
        }

        highlightButton.addEventListener("click", () => commitAnnotation("highlight"));
        bookmarkButton.addEventListener("click", () => commitAnnotation("bookmark"));
        renderSavedPlaces();

        function createCoverPage(book) {
            const page = document.createElement("section");
            page.style.cssText = "width:100%; height:100%; display:flex; align-items:center; justify-content:center; flex-direction:column; box-sizing:border-box; padding:10px 0;";
            if (book.coverUrl && !book.coverUrl.includes("placeholder.jpg")) {
                const image = document.createElement("img"); image.src = book.coverUrl; image.alt = `${book.title || "Publication"} cover art`;
                image.style.cssText = "max-width:100%; max-height:60%; object-fit:contain; border-radius:6px; box-shadow:0 12px 30px rgba(0,0,0,.25); margin-bottom:24px;";
                page.appendChild(image);
            }
            const title = document.createElement("h2"); title.textContent = book.title || "Untitled Publication";
            title.style.cssText = "margin:0; color: var(--koba-text-color); font-family: var(--koba-reader-font); text-align:center; font-size:24px; font-weight:700; line-height:1.25;";
            const author = document.createElement("p"); author.textContent = `By ${book.authorName || 'Sovereign Author'}`;
            author.style.cssText = "color: var(--koba-text-color); font-family: var(--koba-reader-font); opacity:0.7; font-size:14px; margin:10px 0 0; font-weight:500;";
            page.append(title, author); return page;
        }

        const KOBA_EPUB_ALLOWED_TAGS = new Set(["A", "ABBR", "B", "BLOCKQUOTE", "BR", "CITE", "CODE", "DIV", "EM", "FIGCAPTION", "FIGURE", "H1", "H2", "H3", "H4", "H5", "H6", "HR", "I", "IMG", "LI", "OL", "P", "PRE", "SECTION", "SMALL", "SPAN", "STRONG", "SUB", "SUP", "UL"]);
        const KOBA_EPUB_ALLOWED_IMAGE_TYPES = /\.(?:jpe?g|png|gif|svg)(?:[?#].*)?$/i;

        function resolveEpubAssetUrl(value, baseUrl = "") {
            const source = String(value || "").trim();
            if (!source || /^data:|^blob:|^javascript:/i.test(source)) return "";
            try {
                const resolved = new URL(source, baseUrl || window.location.href);
                if (!/^https?:$/.test(resolved.protocol) || !KOBA_EPUB_ALLOWED_IMAGE_TYPES.test(resolved.pathname)) return "";
                return resolved.href;
            } catch { return ""; }
        }

        function sanitizeEpubHtml(htmlValue, baseUrl = "") {
            const parsed = new DOMParser().parseFromString(`<div>${String(htmlValue || "")}</div>`, "text/html");
            const root = parsed.body.firstElementChild;
            if (!root) return document.createDocumentFragment();
            root.querySelectorAll("script,style,iframe,object,embed,form,link,meta,svg").forEach(node => node.remove());
            [...root.querySelectorAll("*")].forEach(node => {
                if (!KOBA_EPUB_ALLOWED_TAGS.has(node.tagName)) {
                    node.replaceWith(...node.childNodes);
                    return;
                }
                [...node.attributes].forEach(attribute => {
                    const name = attribute.name.toLowerCase();
                    if (name.startsWith("on") || !["href", "src", "alt", "title", "class", "role", "aria-label"].includes(name)) node.removeAttribute(attribute.name);
                });
                if (node instanceof HTMLImageElement) {
                    const resolved = resolveEpubAssetUrl(node.getAttribute("src"), baseUrl);
                    if (!resolved) {
                        const unavailable = parsed.createElement("span");
                        unavailable.className = "koba-reader-image-unavailable";
                        unavailable.textContent = node.alt ? `Image unavailable: ${node.alt}` : "Image unavailable";
                        node.replaceWith(unavailable);
                        return;
                    }
                    node.src = resolved;
                    node.alt = node.getAttribute("alt") || "Illustration";
                    node.loading = "lazy";
                    node.addEventListener("error", () => {
                        const unavailable = document.createElement("span");
                        unavailable.className = "koba-reader-image-unavailable";
                        unavailable.textContent = node.alt ? `Image unavailable: ${node.alt}` : "Image unavailable";
                        node.replaceWith(unavailable);
                    }, { once: true });
                }
                if (node instanceof HTMLAnchorElement) {
                    try {
                        const href = new URL(node.getAttribute("href") || "", baseUrl || window.location.href);
                        if (!/^https?:$/.test(href.protocol)) node.removeAttribute("href"); else node.href = href.href;
                    } catch { node.removeAttribute("href"); }
                }
            });
            const fragment = document.createDocumentFragment();
            fragment.append(...root.childNodes);
            return fragment;
        }

        function chapterHtmlValue(chapter) {
            return chapter?.xhtml || chapter?.html || chapter?.textContent || chapter?.body || chapter?.content || "";
        }

        function chapterAssetBase(chapter, book) {
            return chapter?.assetBaseUrl || chapter?.contentBaseUrl || book?.epubAssetBaseUrl || book?.assetBaseUrl || "";
        }

        function epubCoverCandidate(book, chapters) {
            const explicit = book?.epubCoverUrl || book?.epubCover?.href || book?.epubCover?.url || "";
            if (explicit) return resolveEpubAssetUrl(explicit, book?.epubAssetBaseUrl || book?.assetBaseUrl || "");
            const coverChapter = chapters.find(chapter => chapter?.isCover === true || chapter?.properties?.includes?.("cover-image"));
            if (!coverChapter) return "";
            const parsed = new DOMParser().parseFromString(chapterHtmlValue(coverChapter), "text/html");
            return resolveEpubAssetUrl(parsed.querySelector("img")?.getAttribute("src"), chapterAssetBase(coverChapter, book));
        }

        function isDuplicateCoverChapter(chapter, book, primaryCoverUrl) {
            if (!primaryCoverUrl || !(chapter?.isCover === true || chapter?.properties?.includes?.("cover-image"))) return false;
            const parsed = new DOMParser().parseFromString(chapterHtmlValue(chapter), "text/html");
            const images = [...parsed.querySelectorAll("img")];
            return images.length === 1 && resolveEpubAssetUrl(images[0].getAttribute("src"), chapterAssetBase(chapter, book)) === primaryCoverUrl;
        }

        function createTextPage(titleValue, textValue, eyebrowValue = "", assetBaseUrl = "") {
            const page = document.createElement("article");
            page.className = "koba-reader-paginated";
            page.style.cssText = "width:100%; height:100%; min-height:0; box-sizing:border-box;";
            if (eyebrowValue) {
                const eyebrow = document.createElement("div"); eyebrow.textContent = eyebrowValue;
                eyebrow.style.cssText = "width:min(100%, var(--koba-text-width)); margin:0 auto 10px; font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color: var(--koba-text-color); font-family: var(--koba-reader-font); opacity:0.55;";
                page.appendChild(eyebrow);
            }
            const heading = document.createElement("h3"); heading.textContent = titleValue || "Chapter";
            heading.style.cssText = "width:min(100%, var(--koba-text-width)); margin:0 auto 24px; color: var(--koba-text-color); font-family: var(--koba-reader-font); font-size:22px; font-weight:700; border-bottom:1px solid rgba(148,163,184,0.18); padding-bottom:12px; line-height:1.3;";
            const body = document.createElement("div");
            body.className = "koba-reader-copy";
            const content = String(textValue || "");
            if (/<[a-z][\s\S]*>/i.test(content)) body.appendChild(sanitizeEpubHtml(content, assetBaseUrl));
            else body.textContent = content || "This section contains no manuscript text.";
            body.dataset.sourceText = body.textContent;
            body.style.cssText = "width:min(100%, var(--koba-text-width)); margin:0 auto; text-align:left; overflow-wrap:anywhere; color: var(--koba-text-color); font-family: var(--koba-reader-font); font-size: var(--koba-reader-size); line-height: var(--koba-reader-leading);";
            page.append(heading, body); return page;
        }

        function saveReaderProgress() {
            if (illustratedBook) {
                const presentation = readerPages[currentIndex];
                const page = presentation?.pages?.[0];
                if (!page || !presentation.chapterId || !page.id) return;
                localStorage.setItem(progressKey, JSON.stringify({
                    layoutMode: "illustrated_pages",
                    chapterId: presentation.chapterId,
                    pageId: String(page.id),
                    chapterPageIndex: Number(page.chapterPageIndex) || 0,
                    sectionIndex: currentIndex,
                }));
                return;
            }
            localStorage.setItem(progressKey, JSON.stringify({
                sectionIndex: currentIndex,
                visualPage: currentVisualPage,
            }));
        }

        function activePaginatedNode() {
            const node = readerPages[currentIndex]?.node;
            return node?.classList?.contains("koba-reader-paginated") ? node : null;
        }

        function scrollToCurrentVisualPage(behavior = "smooth") {
            const paginatedNode = activePaginatedNode();
            if (!paginatedNode) return;
            const pageWidth = Math.max(1, paginatedNode.clientWidth);
            paginatedNode.scrollTo({
                left: currentVisualPage * pageWidth,
                top: 0,
                behavior: reduceMotion ? "auto" : behavior,
            });
        }

        function measureActivePagination() {
            if (!readerPages.length) return;
            const paginatedNode = activePaginatedNode();
            if (!paginatedNode) {
                currentVisualPage = 0;
                currentVisualPageCount = 1;
                updateReaderControls();
                saveReaderProgress();
                return;
            }
            const pageWidth = Math.max(1, paginatedNode.clientWidth);
            paginatedNode.style.columnWidth = `${pageWidth}px`;
            paginatedNode.style.columnGap = "0px";
            currentVisualPageCount = Math.max(1, Math.round(paginatedNode.scrollWidth / pageWidth));
            currentVisualPage = Math.min(Math.max(0, currentVisualPage), currentVisualPageCount - 1);
            scrollToCurrentVisualPage("auto");
            updateReaderControls();
            saveReaderProgress();
        }

        function bindActivePaginationEvents() {
            const paginatedNode = activePaginatedNode();
            if (!paginatedNode || paginatedNode.dataset.paginationBound === "true") return;
            paginatedNode.dataset.paginationBound = "true";
            const settleToNearestPage = () => {
                const pageWidth = Math.max(1, paginatedNode.clientWidth);
                currentVisualPage = Math.min(
                    currentVisualPageCount - 1,
                    Math.max(0, Math.round(paginatedNode.scrollLeft / pageWidth))
                );
                scrollToCurrentVisualPage("smooth");
                updateReaderControls();
                saveReaderProgress();
            };
            paginatedNode.addEventListener("scroll", () => {
                window.clearTimeout(paginatedNode._kobaScrollTimer);
                paginatedNode._kobaScrollTimer = window.setTimeout(settleToNearestPage, 100);
                showHUD();
            }, { passive: true });
            let swipeStart = null;
            paginatedNode.addEventListener("touchstart", event => {
                if (event.touches.length !== 1 || !window.matchMedia("(max-width: 1023px)").matches) return;
                const selection = window.getSelection();
                if (selection && !selection.isCollapsed) return;
                const touch = event.touches[0];
                swipeStart = { x: touch.clientX, y: touch.clientY, time: performance.now() };
            }, { passive: true });
            paginatedNode.addEventListener("touchend", event => {
                if (!swipeStart || !window.matchMedia("(max-width: 1023px)").matches) {
                    settleToNearestPage();
                    swipeStart = null;
                    return;
                }
                const touch = event.changedTouches[0];
                const deltaX = touch.clientX - swipeStart.x;
                const deltaY = touch.clientY - swipeStart.y;
                const elapsed = Math.max(1, performance.now() - swipeStart.time);
                const horizontalIntent = Math.abs(deltaX) >= 56 && Math.abs(deltaX) > Math.abs(deltaY) * 1.25;
                const quickIntent = Math.abs(deltaX) >= 36 && (Math.abs(deltaX) / elapsed) >= 0.35 && Math.abs(deltaX) > Math.abs(deltaY) * 1.4;
                swipeStart = null;
                if (!horizontalIntent && !quickIntent) return;
                if (deltaX < 0) showNextPage();
                else showPreviousPage();
            }, { passive: true });
            paginatedNode.addEventListener("pointerup", event => {
                if (event.pointerType !== "touch") window.setTimeout(captureAnnotationSelection, 0);
            });
            paginatedNode.addEventListener("touchend", () => window.setTimeout(captureAnnotationSelection, 50), { passive: true });
        }

        async function renderPage() {
            if (!readerPages.length || isTransitioning) return;
            isTransitioning = true;

            if (illustratedBook) {
                window.KobaIllustratedPages.maintainActiveWindow(
                    readerPages,
                    currentIndex,
                    illustratedBook.illustratedPageSettings?.pageBackground || "#111111"
                );
            }

            if (!reduceMotion) {
                container.style.opacity = "0";
                await new Promise(resolve => window.setTimeout(resolve, 150));
            }

            const activePage = readerPages[currentIndex];
            applyHighlights(currentIndex);
            container.replaceChildren(activePage.node);
            bindActivePaginationEvents();
            await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
            measureActivePagination();

            if (!reduceMotion) {
                requestAnimationFrame(() => { container.style.opacity = "1"; });
                await new Promise(resolve => window.setTimeout(resolve, 150));
            }
            isTransitioning = false;
            showHUD();
        }

        function updateReaderControls() {
            const activePage = readerPages[currentIndex];
            if (!activePage) return;
            const sectionProgress = currentIndex + (currentVisualPage / Math.max(1, currentVisualPageCount));
            const isFinalPhysicalPage = currentIndex === readerPages.length - 1 && currentVisualPage >= currentVisualPageCount - 1;
            const percent = isFinalPhysicalPage
                ? 100
                : readerPages.length <= 1
                    ? 100
                    : Math.min(99, Math.round((sectionProgress / readerPages.length) * 100));
            const physicalPageLabel = currentVisualPageCount > 1
                ? ` · Page ${currentVisualPage + 1} of ${currentVisualPageCount}`
                : "";
            pageIndicator.textContent = `${activePage.label}${physicalPageLabel} · ${percent}%`;

            previousButton.disabled = currentIndex === 0 && currentVisualPage === 0;
            nextButton.disabled = currentIndex === readerPages.length - 1 && currentVisualPage >= currentVisualPageCount - 1;

            [previousButton, nextButton].forEach(button => {
                button.style.opacity = button.disabled ? "0.3" : "1";
                button.style.background = button.disabled ? "#111827" : "#1f2937";
                button.style.pointerEvents = button.disabled ? "none" : "auto";
            });
        }

        function applyPublicationBackground(book) {
            const backgroundUrl = typeof book.bgImageUrl === "string" ? book.bgImageUrl.trim() : "";
            if (backgroundUrl) {
                readerShell.style.setProperty("--koba-publication-background", `url("${backgroundUrl.replace(/"/g, '\\"')}")`);
                readerShell.dataset.hasBackdrop = "true";
                readerShell.style.backgroundImage = `linear-gradient(rgba(6, 10, 18, 0.62), rgba(6, 10, 18, 0.82)), url("${backgroundUrl}")`;
                readerShell.style.backgroundSize = "cover"; readerShell.style.backgroundPosition = "center";
            } else {
                readerShell.style.setProperty("--koba-publication-background", "none");
                readerShell.dataset.hasBackdrop = "false"; readerShell.style.backgroundImage = "none";
            }
        }

        ["copy", "cut", "contextmenu"].forEach(eventName => {
            viewportCard.addEventListener(eventName, event => event.preventDefault());
        });

        viewportCard.addEventListener("dragstart", event => event.preventDefault());
        document.addEventListener("pointerdown", event => {
            if (!annotationMenu.contains(event.target) && !viewportCard.contains(event.target)) {
                hideAnnotationMenu(false);
            }
        });

        let resizeTimer;
        function refreshIllustratedLayout() {
            if (!illustratedBook || !window.KobaIllustratedPages) return false;
            const activePresentation = readerPages[currentIndex];
            const activeProgress = activePresentation?.pages?.[0]
                ? {
                    chapterId: activePresentation.chapterId,
                    pageId: String(activePresentation.pages[0].id || ""),
                    chapterPageIndex: Number(activePresentation.pages[0].chapterPageIndex) || 0,
                }
                : null;
            const rebuilt = window.KobaIllustratedPages.buildReaderPages(illustratedBook, {
                width: Math.max(1, container.clientWidth),
                height: Math.max(1, container.clientHeight),
            });
            const signature = rebuilt.map(item => item.pages.length).join(",");
            if (signature === illustratedGroupSignature) return true;
            illustratedGroupSignature = signature;
            const coverOffset = readerPages[0]?.type === "cover" ? 1 : 0;
            window.KobaIllustratedPages.maintainActiveWindow(readerPages, -10, "#111111");
            readerPages = coverOffset ? [readerPages[0], ...rebuilt] : rebuilt;
            currentIndex = activeProgress
                ? coverOffset + window.KobaIllustratedPages.locateProgress(rebuilt, activeProgress)
                : 0;
            currentVisualPage = 0;
            void renderPage();
            return true;
        }
        window.addEventListener("resize", () => {
            window.clearTimeout(resizeTimer);
            resizeTimer = window.setTimeout(() => { if (!refreshIllustratedLayout()) measureActivePagination(); }, 120);
        }, { passive: true });
        if ("ResizeObserver" in window) {
            const readerResizeObserver = new ResizeObserver(() => {
                window.clearTimeout(resizeTimer);
                resizeTimer = window.setTimeout(() => { if (!refreshIllustratedLayout()) measureActivePagination(); }, 80);
            });
            readerResizeObserver.observe(container);
        }

        readerShell.addEventListener("pointermove", showHUD, { passive: true });
        readerShell.addEventListener("pointerdown", showHUD, { passive: true });
        readerShell.addEventListener("touchstart", showHUD, { passive: true });
        
        navTray.addEventListener("focusin", showHUD);
        settingsPanel.addEventListener("focusin", showHUD);
        navTray.addEventListener("focusout", resetHUDTimeout);
        settingsPanel.addEventListener("focusout", resetHUDTimeout);

        requestAuthorizedPublication()
            .then(data => {
                if (!data || data.success !== true || !Array.isArray(data.products)) throw new Error("Malformed data mapping matrix.");

                const book = data.products.find(p => p.assetKey === assetKey);
                if (!book) throw new Error("Manuscript lookup record missing.");

                applyPublicationBackground(book);

                if (book.layoutMode === "illustrated_pages") {
                    if (!window.KobaIllustratedPages) throw new Error("Illustrated page presentation engine did not load.");
                    const coverUrl = resolveEpubAssetUrl(book.coverUrl || book.coverArtUrl || "");
                    readerPages = coverUrl
                        ? [{ type: "cover", label: "Cover", node: createCoverPage({ ...book, coverUrl }) }]
                        : [];
                    illustratedBook = book;
                    const illustratedPages = window.KobaIllustratedPages.buildReaderPages(book, {
                        width: Math.max(1, container.clientWidth),
                        height: Math.max(1, container.clientHeight),
                    });
                    illustratedGroupSignature = illustratedPages.map(item => item.pages.length).join(",");
                    readerPages.push(...illustratedPages);
                    if (!readerPages.length) throw new Error("This illustrated publication does not contain any available pages.");
                    settingsButton.hidden = true;
                    settingsPanel.hidden = true;
                    let savedProgress = null;
                    try { savedProgress = JSON.parse(localStorage.getItem(progressKey) || "null"); } catch (error) { savedProgress = null; }
                    const coverOffset = readerPages[0]?.type === "cover" ? 1 : 0;
                    currentIndex = savedProgress?.chapterId && savedProgress?.pageId
                        ? coverOffset + window.KobaIllustratedPages.locateProgress(illustratedPages, savedProgress)
                        : 0;
                    currentVisualPage = 0;
                    renderPage();
                    resetHUDTimeout();
                    if (typeof window.revealMediaCanvas === "function") window.revealMediaCanvas();
                    return;
                }

                const chapters = Array.isArray(book.chapters) ? book.chapters : [];
                const epubCoverUrl = epubCoverCandidate(book, chapters);
                const primaryCoverUrl = resolveEpubAssetUrl(book.coverUrl || book.coverArtUrl || "") || epubCoverUrl;
                readerPages = [{ type: "cover", label: "Cover", node: createCoverPage({ ...book, coverUrl: primaryCoverUrl }) }];
                if (typeof book.description === "string" && book.description.trim() !== "") {
                    readerPages.push({ type: "synopsis", label: "Synopsis", node: createTextPage("Synopsis", book.description) });
                }

                chapters.forEach((chapter, chapterIndex) => {
                    if (isDuplicateCoverChapter(chapter, book, primaryCoverUrl)) return;
                    const orderLabel = `Chapter ${chapterIndex + 1} of ${chapters.length}`;
                    readerPages.push({
                        type: "chapter", label: orderLabel,
                        node: createTextPage(chapter?.title || `Chapter ${chapterIndex + 1}`, chapterHtmlValue(chapter), orderLabel, chapterAssetBase(chapter, book))
                    });
                });

                loadReaderPreferences();
                readerPages.forEach((page, pageIndex) => applyHighlights(pageIndex));

                const savedProgressValue = localStorage.getItem(progressKey);
                let savedSectionIndex = 0;
                let savedVisualPage = 0;
                try {
                    const parsedProgress = JSON.parse(savedProgressValue || "null");
                    if (parsedProgress && typeof parsedProgress === "object") {
                        savedSectionIndex = Number(parsedProgress.sectionIndex) || 0;
                        savedVisualPage = Number(parsedProgress.visualPage) || 0;
                    } else if (Number.isInteger(parsedProgress)) {
                        savedSectionIndex = parsedProgress;
                    }
                } catch (error) {
                    const legacyIndex = parseInt(savedProgressValue, 10);
                    if (!isNaN(legacyIndex)) savedSectionIndex = legacyIndex;
                }
                currentIndex = savedSectionIndex >= 0 && savedSectionIndex < readerPages.length
                    ? savedSectionIndex
                    : 0;
                currentVisualPage = Math.max(0, savedVisualPage);

                renderPage();
                resetHUDTimeout();
                if (typeof window.revealMediaCanvas === "function") {
                    window.revealMediaCanvas();
                }
            })
            .catch(error => {
                console.error("[KOBA Core Engine Handshake Fault]:", error);
                const failure = document.createElement("div");
                failure.style.cssText = "color:#ef4444;padding-top:100px;text-align:center;";
                const heading = document.createElement("strong");
                heading.textContent = "Unable to open this publication";
                const detail = document.createElement("p");
                detail.textContent = error instanceof Error ? error.message : "Verified access is required.";
                failure.append(heading, detail);
                container.replaceChildren(failure);
                if (typeof window.revealMediaCanvas === "function") {
                    window.revealMediaCanvas();
                }
            });

        function saveReaderPreferences() {
            localStorage.setItem(globalPrefKey, JSON.stringify({
                pageColor: pageColorSelect.value, font: fontSelect.value, fontSize: fontSizeRange.value, lineHeight: lineHeightRange.value, marginWidth: marginSelect.value
            }));
        }

        function loadReaderPreferences() {
            try {
                const saved = JSON.parse(localStorage.getItem(globalPrefKey));
                if (saved) {
                    if (saved.pageColor) pageColorSelect.value = saved.pageColor;
                    if (saved.font) fontSelect.value = saved.font;
                    if (saved.fontSize) fontSizeRange.value = saved.fontSize;
                    if (saved.lineHeight) lineHeightRange.value = saved.lineHeight;
                    if (saved.marginWidth) marginSelect.value = saved.marginWidth;
                }
            } catch (error) {}
            applyReaderPreferences(false);
        }

        function applyReaderPreferences(save = true) {
            const themeColors = {
                "#fffdf7": "#221f1a",
                "#ffffff": "#111111",
                "#f4ecd8": "#221f1a",
                "#1f2933": "#f8fafc"
            };

            const selectedBg = pageColorSelect.value;
            const mappedText = themeColors[selectedBg] || "#221f1a";

            viewportCard.style.setProperty("--koba-page-color", selectedBg);
            viewportCard.style.setProperty("--koba-text-color", mappedText);
            viewportCard.style.setProperty("--koba-reader-font", fontSelect.value);
            viewportCard.style.setProperty("--koba-reader-size", `${fontSizeRange.value}px`);
            viewportCard.style.setProperty("--koba-reader-leading", lineHeightRange.value);
            viewportCard.style.setProperty("--koba-text-width", marginSelect.value);

            viewportCard.dataset.readerTheme = selectedBg === "#1f2933" ? "dark" : "light";
            if (save) saveReaderPreferences();
            if (readerPages.length) window.setTimeout(measureActivePagination, 0);
        }

        async function toggleFullscreenMode() {
            try {
                if (!document.fullscreenElement) {
                    await readerShell.requestFullscreen();
                    if (screen.orientation && typeof screen.orientation.lock === "function") {
                        screen.orientation.lock("portrait").catch(() => {});
                    }
                } else {
                    if (screen.orientation && typeof screen.orientation.unlock === "function") screen.orientation.unlock();
                    await document.exitFullscreen();
                }
            } catch (error) { console.error("[KOBA Reader] Fullscreen request failed.", error); }
        }

        document.addEventListener("fullscreenchange", () => {
            const isFullscreen = document.fullscreenElement === readerShell;
            if (!isFullscreen && screen.orientation && typeof screen.orientation.unlock === "function") {
                screen.orientation.unlock();
            }
            readerShell.classList.toggle("is-fullscreen", isFullscreen);
            fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
            fullscreenButton.style.background = isFullscreen ? "#3b82f6" : "#1f2937";
            if (window.matchMedia("(min-width: 1024px)").matches) {
                viewportCard.style.height = isFullscreen ? "min(88vh, 920px)" : "min(78vh, 820px)";
            } else {
                viewportCard.style.removeProperty("height");
            }
            window.setTimeout(measureActivePagination, 100);
            showHUD();
        });

        fullscreenButton.addEventListener("click", toggleFullscreenMode);

        settingsButton.addEventListener("click", (event) => {
            event.stopPropagation();
            if (settingsPanel.hidden) {
                settingsPanel.hidden = false; void settingsPanel.offsetHeight; settingsPanel.style.opacity = "1";
            } else {
                settingsPanel.style.opacity = "0"; setTimeout(() => { settingsPanel.hidden = true; }, 200);
            }
            resetHUDTimeout();
        });
        
        pageColorSelect.addEventListener("change", () => applyReaderPreferences(true));
        fontSelect.addEventListener("change", () => applyReaderPreferences(true));
        marginSelect.addEventListener("change", () => applyReaderPreferences(true));
        fontSizeRange.addEventListener("input", () => applyReaderPreferences(true));
        lineHeightRange.addEventListener("input", () => applyReaderPreferences(true));

        function showNextPage() {
            if (isTransitioning) return;
            if (currentVisualPage < currentVisualPageCount - 1) {
                currentVisualPage += 1;
                scrollToCurrentVisualPage();
                updateReaderControls();
                saveReaderProgress();
                return;
            }
            if (currentIndex < readerPages.length - 1) {
                currentIndex += 1;
                currentVisualPage = 0;
                renderPage();
            }
        }

        function showPreviousPage() {
            if (isTransitioning) return;
            if (currentVisualPage > 0) {
                currentVisualPage -= 1;
                scrollToCurrentVisualPage();
                updateReaderControls();
                saveReaderProgress();
                return;
            }
            if (currentIndex > 0) {
                currentIndex -= 1;
                currentVisualPage = Number.MAX_SAFE_INTEGER;
                renderPage();
            }
        }

        previousButton.addEventListener("click", showPreviousPage);
        nextButton.addEventListener("click", showNextPage);

        window.addEventListener("keydown", event => {
            const activeElement = document.activeElement;
            const activeTag = activeElement?.tagName?.toLowerCase();
            if (activeTag === "input" || activeTag === "textarea" || activeTag === "select" || activeElement?.isContentEditable) return;
            if (event.key === "ArrowRight") { event.preventDefault(); showNextPage(); }
            if (event.key === "ArrowLeft") { event.preventDefault(); showPreviousPage(); }
        });
    })();
    </script>
    <?php
}

/* =========================================================================
    🛡️ CANVAS INTERCEPT FILTER: CONTRACT RECONCILIATION GATE
========================================================================= */
add_filter('template_include', 'koba_enforce_clean_application_canvas', 999);
function koba_enforce_clean_application_canvas($template) {
    global $post;

    // Never replace admin, background, preview, feed, embed, archive, or
    // secondary-query templates. The sovereign canvas owns only the main
    // singular publication request or an explicit bookshelf asset request.
    if (
        !$post instanceof WP_Post
        || is_admin()
        || wp_doing_ajax()
        || wp_doing_cron()
        || is_preview()
        || is_feed()
        || is_embed()
        || !is_main_query()
    ) {
        return $template;
    }

    $requested_asset = isset($_GET['asset'])
        ? sanitize_key(wp_unslash($_GET['asset']))
        : '';
    $is_root_bookshelf = is_page('bookshelf')
        && $post->post_type === 'page'
        && get_queried_object_id() === (int) $post->ID;
    $has_query_asset = $requested_asset !== '';
    $is_single_cpt = is_singular('koba_publication')
        && $post->post_type === 'koba_publication'
        && get_queried_object_id() === (int) $post->ID;

    if ($is_root_bookshelf && !$has_query_asset) {
        return $template; 
    }

    if ($is_single_cpt || ($is_root_bookshelf && $has_query_asset)) {
        $book_id = $post->ID;
        $asset_key = koba_resolve_publication_asset_key(
            $book_id,
            $has_query_asset
                ? $requested_asset
                : ''
        );

        $media_type = strtolower(
            trim((string) get_post_meta($book_id, '_koba_media_type', true))
        );
        $is_audiobook = in_array(
            $media_type,
            array('audio', 'audiobook'),
            true
        ) || strpos($asset_key, 'abk_') === 0
          || strpos($asset_key, 'aud_') === 0;

        wp_enqueue_style('bloom-style', plugin_dir_url(__FILE__) . 'assets/bloom-style.css', array(), time());
        wp_enqueue_script('koba-reader-handoff-js', plugin_dir_url(__FILE__) . 'assets/reader-handoff.js', array(), time(), true);
        wp_enqueue_script('jubilee-core-js', plugin_dir_url(__FILE__) . 'assets/jubilee-core.js', array('koba-reader-handoff-js'), time(), true);
        wp_enqueue_script('bloom-player-js', plugin_dir_url(__FILE__) . 'assets/bloom-player.js', array('jubilee-core-js'), time(), true);
        
        // Fully Hydrated Presentation Contract Localization Pass
        $dashboard_url = koba_get_dashboard_url();
        wp_localize_script(
            'koba-reader-handoff-js',
            'JubileeConfig',
            array(
                'dashboardUrl' => $dashboard_url,
                'apiUrl'       => rest_url('kobai/v1/storefront-catalog'),
                'pluginUrl'    => KOBA_IA_URL,
                'logoUrl'      => KOBA_IA_URL . 'assets/koba-logo-text-transparent.png',
                'readerUrl'    => koba_get_authoritative_bookstore_url(),
                'studioKey'    => sanitize_text_field(get_option('koba_license_key', '')),
            )
        );

        $bg_color = get_post_meta($book_id, '_koba_bg_color', true) ?: '#070a0f';
        ?>
        <!DOCTYPE html>
        <html <?php language_attributes(); ?> style="margin-top: 0 !important; background: <?php echo esc_attr($bg_color); ?>;">
        <head>
            <meta charset="<?php bloginfo('charset'); ?>">
            <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
            <title><?php echo esc_html(get_the_title($book_id)); ?> - Secure Vault Canvas</title>
            <style>
                html, body { margin: 0 !important; padding: 0 !important; width: 100vw; height: 100vh; color: #fff; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; overflow: hidden; }
                #koba-app-viewport { width: 100vw; height: 100vh; display: flex; align-items: center; justify-content: center; position: relative; }
                .koba-gate-screen { text-align: center; max-width: 450px; padding: 45px; background: #0d1117; border: 1px solid #30363d; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.5); z-index: 10; position: relative; }
                .koba-primary-btn { display: inline-block; background: #f97316; color: #000; padding: 14px 28px; font-size: 1rem; font-weight: bold; text-decoration: none; border-radius: 6px; border: none; cursor: pointer; margin-top: 20px; }
                #wpadminbar { display: none !important; }
            </style>
            <?php wp_head(); ?>
        </head>
        <body>
            <div id="koba-app-viewport">
                <a
                    class="k-bloom-back-to-store"
                    data-koba-authoritative-back
                    href="<?php echo esc_url(koba_get_authoritative_bookstore_url()); ?>"
                    aria-label="Back to Bookstore"
                >&larr; Back to Bookstore</a>
                <div id="koba-vault-door" class="koba-gate-screen">
                    <h2 style="color: #fff; margin-top: 0;" id="vault-door-message">Verifying Vault Access...</h2>
                    <p style="color: #8b949e; font-size: 0.95rem; line-height: 1.5;">Analyzing core framework signatures.</p>
                    <div id="koba-ui-error-region" role="alert" aria-live="polite" style="color:#ff7b72; margin-top:14px; font-size:0.875rem; font-weight:500; min-height:1.25rem; line-height:1.4;"></div>
                </div>

                <div id="bloom-player-wrapper" style="display: <?php echo $is_audiobook ? 'none !important' : 'none'; ?>; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0;">
                    <?php
                    koba_render_sovereign_player_engine(
                        $book_id,
                        $asset_key
                    );
                    ?>
                </div>
            </div>
            
            <script>
                window.revealMediaCanvas = function() {
                    const vaultDoor = document.getElementById("koba-vault-door");
                    const playerWrapper = document.getElementById("bloom-player-wrapper");
                    if (vaultDoor) vaultDoor.style.display = "none";
                    if (playerWrapper) playerWrapper.style.display = "block";
                };
            </script>

            <!-- 🔬 HARDENED LOCAL PORT STRIPPER GATE -->
            <?php
            $host = strtolower(preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? ''));
            $is_local_environment = wp_get_environment_type() === 'local'
                || in_array(
                    $host,
                    array(
                        'koba-dev.local',
                        'localhost',
                        '127.0.0.1'
                    ),
                    true
                );
            ?>

            <?php if ($is_local_environment && !$is_audiobook) : ?>
            <script>
                document.addEventListener("DOMContentLoaded", function () {
                    window.setTimeout(function () {
                        if (typeof window.revealMediaCanvas === "function") {
                            window.revealMediaCanvas();
                        }
                    }, 800);
                });
            </script>
            <?php endif; ?>

            <?php wp_footer(); ?>
        </body>
        </html>
        <?php
        exit;
    }
    return $template;
}
