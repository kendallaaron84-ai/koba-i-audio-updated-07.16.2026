<?php
/**
 * Plugin Name: KOBA-I Audio - Jubilee Edition
 * Version: 6.0.1
 * Description: Tier-1 Audiobook & Video Player with E-Reader Cloud Studio and Buyer Matrix.
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

    if (isset($_POST['koba_key'])) {
        $new_key = sanitize_text_field($_POST['koba_key']);
        update_option('koba_license_key', trim($new_key));
        update_option('koba_license_status', 'inactive');
    }

    wp_redirect(admin_url('admin.php?page=koba-license&settings-updated=true'));
    exit;
}

// 3. REGISTER POST TYPE
add_action('init', function() {
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
});

/* =========================================================================
    🤖 AUTONOMOUS AGENT ENDPOINT: /wp-json/kobai/v1/publish-vault
========================================================================= */
add_action('rest_api_init', function () {
    register_rest_route('kobai/v1', '/publish-vault', [
        'methods'             => 'POST',
        'callback'            => 'koba_agent_create_vault_page',
        'permission_callback' => '__return_true' 
    ]);
    register_rest_route('kobai/v1', '/update-chapter-audio', [
        'methods'             => 'POST',
        'callback'            => 'koba_agent_create_vault_page',
        'permission_callback' => '__return_true' 
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

    $pub_query = new WP_Query(array(
        'post_type'   => 'koba_publication',
        'name'        => $book_slug,
        'post_status' => 'any',
        'posts_per_page' => 1
    ));

    $pub_id = 0;
    $pub_data = array(
        'post_title'  => $book_title,
        'post_status' => 'publish',
        'post_type'   => 'koba_publication',
        'post_name'   => $book_slug
    );

    if ($pub_query->have_posts()) {
        $pub_id = $pub_query->posts[0]->ID;
        $pub_data['ID'] = $pub_id;
        wp_update_post($pub_data);
    } else {
        $pub_id = wp_insert_post($pub_data);
    }

    update_post_meta($pub_id, 'koba_asset_key', $asset_key);
    update_post_meta($pub_id, 'assetKey', $asset_key);
    update_post_meta($pub_id, 'authorSlug', $author_slug);
    update_post_meta($pub_id, '_koba_cover_art_url', $cover_art);
    update_post_meta($pub_id, '_koba_bg_image_url', $bg_image);
    update_post_meta($pub_id, '_koba_media_type', $media_type);
    update_post_meta($pub_id, '_koba_price', $price);
    
    if (!empty($ebook_data)) {
        update_post_meta($pub_id, '_koba_chapters_data', $ebook_data);
    }

    $existing_page = get_page_by_path($book_slug, OBJECT, 'page');
    $page_content = '[koba_bloom_player]';

    $page_data = array(
        'post_title'   => $book_title,
        'post_content' => $page_content,
        'post_status'  => 'publish',
        'post_type'    => 'page',
        'post_name'    => $book_slug
    );

    if ($existing_page) {
        $page_data['ID'] = $existing_page->ID;
        $page_id = wp_update_post($page_data);
    } else {
        $page_id = wp_insert_post($page_data);
    }

    update_post_meta($page_id, 'assetKey', $asset_key);
    update_post_meta($page_id, 'authorSlug', $author_slug);
    update_post_meta($page_id, '_koba_cover_art_url', $cover_art);
    update_post_meta($page_id, '_koba_bg_image_url', $bg_image);
    update_post_meta($page_id, '_koba_media_type', $media_type);
    update_post_meta($page_id, '_koba_price', $price);
    if (!empty($ebook_data)) {
        update_post_meta($page_id, '_koba_chapters_data', $ebook_data);
    }

    return rest_ensure_response(array(
        'success'        => true,
        'url'            => home_url('/koba_publication/' . $book_slug . '/'),
        'page_id'        => $page_id,
        'publication_id' => $pub_id
    ));
}

/* =========================================================================
    6. COMMAND CENTER SYNC ENGINE & ADMIN MANAGEMENT
========================================================================= */
if (!function_exists('koba_get_dashboard_url')) {
    function koba_get_dashboard_url() {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $referer = $_SERVER['HTTP_REFERER'] ?? '';
        $host = $_SERVER['HTTP_HOST'] ?? '';
        
        if (strpos($origin, 'ngrok-free.dev') !== false || strpos($referer, 'ngrok-free.dev') !== false || strpos($host, 'ngrok-free.dev') !== false) {
            return 'https://barbecue-scuff-scale.ngrok-free.dev';
        }

        $port = '3000';
        if (strpos($origin, 'localhost') !== false || strpos($referer, 'localhost') !== false || strpos($host, 'localhost') !== false || strpos($host, 'local') !== false) {
            return "http://localhost:{$port}";
        }
        
        return 'https://dashboard.koba-i.com';
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
    echo '<input type="text" name="koba_key" value="' . esc_attr($current_key) . '" placeholder="JUBI-XXXX-XXXX-XXXX" style="width: 100%; padding: 10px; margin-bottom: 15px; font-family: monospace;" required>';
    echo '<button type="submit" class="button button-primary button-large" style="width: 100%;">' . ($status === 'active' ? 'Update License Key' : 'Verify & Activate') . '</button>';
    echo '</form>';
    echo '</div>';
}

add_action('admin_notices', function() {
    if (isset($_GET['page']) && $_GET['page'] === 'koba-license' && isset($_GET['success']) && $_GET['success'] === 'true') {
        echo '<div class="notice notice-success is-dismissible"><p>🎉 Jubilee Studio activated successfully! Your domain is now securely locked.</p></div>';
    }
});

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

    wp_enqueue_script(
        'jubilee-core-js',
        KOBA_IA_URL . 'assets/jubilee-core.js',
        array(),
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

    $current_user =
        wp_get_current_user();

    $user_phone = '';

    if ($current_user->ID !== 0) {
        $user_phone =
            get_user_meta(
                $current_user->ID,
                'billing_phone',
                true
            )
            ?: get_user_meta(
                $current_user->ID,
                'phone_number',
                true
            )
            ?: '';
    }

    wp_localize_script(
        'jubilee-core-js',
        'JubileeConfig',
        array(
            'dashboardUrl' =>
                $dashboard_url,

            'apiUrl' =>
                $dashboard_url .
                '/api/products/public',

            'checkoutUrl' =>
                $dashboard_url .
                '/api/checkout',

            'userPhone' =>
                sanitize_text_field(
                    $user_phone
                ),

            'readerUrl' =>
                home_url('/bookshelf/'),
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
                Missing audiobook asset key.
            </div>
        ';
    }

    ob_start();

    koba_render_bloom_player_ui(
        $book_id,
        $asset_key
    );

    return ob_get_clean();
}

function render_jubilee_matrix_buyer_catalog($atts) {
    $args = shortcode_atts(array('author' => '', 'type' => ''), $atts);
    if (empty($args['author'])) return '<p style="color:#ef4444; font-weight:bold;">Error: Please specify an author attribute context.</p>';
    
    return sprintf(
        '<div id="jubilee-catalog-root" data-author="%s" data-type="%s" class="jubilee-matrix-loading">
            <div class="jubilee-spinner-wrapper" style="text-align:center; padding: 40px 0;">
                <div class="jubilee-spinner" style="display:inline-block; width:40px; height:40px; border:4px solid #333; border-top-color:#f97316; border-radius:50%%; animation: jSpin 1s linear infinite;"></div>
            </div>
         </div>
         <style>@keyframes jSpin { to { transform: rotate(360deg); } }</style>',
        esc_attr($args['author']), esc_attr($args['type'])
    );
}

add_shortcode(
    'koba_window',
    'koba_render_window_shortcode'
);

function koba_render_window_shortcode($atts = array()) {
    $atts = shortcode_atts(
        array(
            'author' => 'global',
            'type'   => '',
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
    ?>
    <!-- 🎧 AUDIOBOOK COMPONENT MOUNT POINT -->
    <div 
        id="jubilee-bloom-root" 
        data-asset="<?php echo esc_attr($asset_key); ?>" 
        data-post-id="<?php echo esc_attr($book_id); ?>"
        data-studio-key="<?php echo esc_attr($studio_key); ?>"
        data-api="<?php echo esc_url($dashboard_url . '/api/products/public'); ?>"
        style="width:100%; height:100%; display:flex; align-items:center; justify-content:center;"
    >
        <div style="color: #64748b; font-family: system-ui, sans-serif; text-align: center;">
            <span style="font-size:24px; display:inline-block; animation: spin 2s linear infinite;">💿</span><br><br>
            Mounting Sovereign Audio Canvas Component Layers...
        </div>
    </div>
    <?php
}



/* =========================================================================
    📖 EBOOK BRANCH ENGINE: THE HIGH-PERFORMANCE GLASS READER
========================================================================= */
function koba_render_sovereign_reader_engine($post_id, $asset_key) {
    $base_api_url = defined('KOBA_NEXTJS_API_URL') ? KOBA_NEXTJS_API_URL : 'http://localhost:3000';
    $token_url = rest_url('kobai/v1/reader-token');
    $wp_nonce = wp_create_nonce('wp_rest');
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
                overflow-y: auto !important;
                transition: background 0.25s ease, color 0.25s ease !important;
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
            @media (max-width: 640px) {
                .koba-reader-shell {
                    padding: 12px !important;
                }
                .koba-reader-stage {
                    grid-template-rows: minmax(0, 1fr) auto auto !important;
                    gap: 8px !important;
                }
                .koba-reader-page {
                    width: 100% !important;
                    padding: 24px !important;
                    border-radius: 4px !important;
                }
                .koba-reader-hud {
                    width: 100% !important;
                    grid-template-columns: 44px minmax(0, 1fr) 44px 44px !important;
                    gap: 8px !important;
                    padding: 8px !important;
                    box-sizing: border-box !important;
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
            @media (min-width: 641px) {
                .koba-btn-text-short {
                    display: none !important;
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

        <div class="koba-reader-backdrop" aria-hidden="true"></div>

        <div class="koba-reader-stage">
            <main class="koba-reader-page">
                <div
                    id="koba-ebook-canvas-root"
                    data-asset="<?php echo esc_attr($asset_key); ?>"
                    data-api="<?php echo esc_url($base_api_url . '/api/products/public'); ?>"
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

        if (!apiUrl || !assetKey || !container || !viewportCard || !stage || !readerShell) return;

        const globalPrefKey = "koba_reader_preferences_v1";
        const progressKey = `koba_reader_progress_${assetKey}`;
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        
        container.style.transition = reduceMotion ? "none" : "opacity 150ms ease";

        let readerPages = [];
        let currentIndex = 0;
        let isTransitioning = false;
        let hudIdleTimeout;

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
        previousButton.innerHTML = '<span class="koba-btn-text-long">← Previous</span><span class="koba-btn-text-short">←</span>';
        previousButton.style.cssText = "background:#1f2937; color:#fff; border:1px solid #374151; padding:10px 16px; border-radius:6px; cursor:pointer; font-weight:500; font-size:14px; transition:opacity .2s; user-select:none; justify-self:start;";

        const pageIndicator = document.createElement("span");
        pageIndicator.setAttribute("aria-live", "polite");
        pageIndicator.style.cssText = "color:#cbd5e1; font-size:13px; font-weight:500; text-align:center; user-select:none; justify-self:center; white-space:nowrap;";

        const settingsButton = document.createElement("button");
        settingsButton.type = "button";
        settingsButton.textContent = "Aa";
        settingsButton.setAttribute("aria-label", "Adjust composition styles");
        settingsButton.style.cssText = "background:#1f2937; color:#fff; border:1px solid #374151; width:42px; height:42px; border-radius:6px; cursor:pointer; font-size:16px; font-weight:700; justify-self:center;";

        const fullscreenButton = document.createElement("button");
        fullscreenButton.type = "button";
        fullscreenButton.textContent = "⛶";
        fullscreenButton.setAttribute("aria-label", "Toggle fullscreen immersion");
        fullscreenButton.setAttribute("aria-pressed", "false");
        fullscreenButton.style.cssText = "background:#1f2937; color:#fff; border:1px solid #374151; width:42px; height:42px; border-radius:6px; cursor:pointer; font-size:16px; font-weight:700; justify-self:center;";

        const nextButton = document.createElement("button");
        nextButton.type = "button";
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

        settingsPanel.append(pageColorGroup, fontGroup, fontSizeGroup, lineHeightGroup, marginSelectGroup);
        stage.append(navTray, settingsPanel);

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

        function createTextPage(titleValue, textValue, eyebrowValue = "") {
            const page = document.createElement("article");
            page.style.cssText = "width:100%; min-height:100%; display:flex; flex-direction:column; box-sizing:border-box;";
            if (eyebrowValue) {
                const eyebrow = document.createElement("div"); eyebrow.textContent = eyebrowValue;
                eyebrow.style.cssText = "width:min(100%, var(--koba-text-width)); margin:0 auto 10px; font-size:11px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; color: var(--koba-text-color); font-family: var(--koba-reader-font); opacity:0.55;";
                page.appendChild(eyebrow);
            }
            const heading = document.createElement("h3"); heading.textContent = titleValue || "Chapter";
            heading.style.cssText = "width:min(100%, var(--koba-text-width)); margin:0 auto 24px; color: var(--koba-text-color); font-family: var(--koba-reader-font); font-size:22px; font-weight:700; border-bottom:1px solid rgba(148,163,184,0.18); padding-bottom:12px; line-height:1.3;";
            const body = document.createElement("div"); body.textContent = textValue || "This section contains no manuscript text.";
            body.style.cssText = "width:min(100%, var(--koba-text-width)); margin:0 auto; text-align:left; white-space:pre-wrap; overflow-wrap:anywhere; color: var(--koba-text-color); font-family: var(--koba-reader-font); font-size: var(--koba-reader-size); line-height: var(--koba-reader-leading);";
            page.append(heading, body); return page;
        }

        async function renderPage() {
            if (!readerPages.length || isTransitioning) return;
            isTransitioning = true;

            if (!reduceMotion) {
                container.style.opacity = "0";
                await new Promise(resolve => window.setTimeout(resolve, 150));
            }

            const activePage = readerPages[currentIndex];
            container.replaceChildren(activePage.node);
            updateReaderControls();

            const scrollPosKey = `koba_reader_scroll_${assetKey}_sec_${currentIndex}`;
            const savedScroll = parseInt(localStorage.getItem(scrollPosKey), 10);
            viewportCard.scrollTop = (!isNaN(savedScroll) && savedScroll > 0) ? savedScroll : 0;

            localStorage.setItem(progressKey, String(currentIndex));

            if (!reduceMotion) {
                requestAnimationFrame(() => { container.style.opacity = "1"; });
                await new Promise(resolve => window.setTimeout(resolve, 150));
            }
            isTransitioning = false;
            showHUD();
        }

        function updateReaderControls() {
            const activePage = readerPages[currentIndex];
            const percent = readerPages.length <= 1 ? 100 : Math.round((currentIndex / (readerPages.length - 1)) * 100);
            pageIndicator.textContent = `${activePage.label} • ${percent}%`;

            previousButton.disabled = currentIndex === 0;
            nextButton.disabled = currentIndex === readerPages.length - 1;

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

        viewportCard.addEventListener("scroll", () => {
            if (!isTransitioning && readerPages.length > 0) {
                const scrollPosKey = `koba_reader_scroll_${assetKey}_sec_${currentIndex}`;
                localStorage.setItem(scrollPosKey, viewportCard.scrollTop);
                hideHUD(); 
            }
        });

        readerShell.addEventListener("pointermove", showHUD, { passive: true });
        readerShell.addEventListener("pointerdown", showHUD, { passive: true });
        readerShell.addEventListener("touchstart", showHUD, { passive: true });
        
        navTray.addEventListener("focusin", showHUD);
        settingsPanel.addEventListener("focusin", showHUD);
        navTray.addEventListener("focusout", resetHUDTimeout);
        settingsPanel.addEventListener("focusout", resetHUDTimeout);

        fetch(
            `${apiUrl}?asset=${encodeURIComponent(assetKey)}`
        )
            .then(async response => {
                let data;
                try { data = await response.json(); } catch {
                    throw new Error(`Catalog API returned invalid payload context.`);
                }
                if (!response.ok) throw new Error(data?.error || `Request failed.`);
                return data;
            })
            .then(data => {
                if (!data || data.success !== true || !Array.isArray(data.products)) throw new Error("Malformed data mapping matrix.");

                const book = data.products.find(p => p.assetKey === assetKey);
                if (!book) throw new Error("Manuscript lookup record missing.");

                applyPublicationBackground(book);

                readerPages = [{ type: "cover", label: "Cover", node: createCoverPage(book) }];
                if (typeof book.description === "string" && book.description.trim() !== "") {
                    readerPages.push({ type: "synopsis", label: "Synopsis", node: createTextPage("Synopsis", book.description) });
                }

                const chapters = Array.isArray(book.chapters) ? book.chapters : [];
                chapters.forEach((chapter, chapterIndex) => {
                    const orderLabel = `Chapter ${chapterIndex + 1} of ${chapters.length}`;
                    readerPages.push({
                        type: "chapter", label: orderLabel,
                        node: createTextPage(chapter?.title || `Chapter ${chapterIndex + 1}`, chapter?.textContent || chapter?.body || chapter?.content || "", orderLabel)
                    });
                });

                loadReaderPreferences();

                const savedIndex = parseInt(localStorage.getItem(progressKey), 10);
                if (!isNaN(savedIndex) && savedIndex >= 0 && savedIndex < readerPages.length) {
                    currentIndex = savedIndex;
                } else {
                    currentIndex = 0;
                }

                renderPage();
                resetHUDTimeout();
            })
            .catch(error => {
                console.error("[KOBA Core Engine Handshake Fault]:", error);
                container.innerHTML = `<div style="color: #ef4444; padding-top: 100px; text-align: center;"><strong>Engine Connect Error</strong><br>${error.message}</div>`;
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
        }

        async function toggleFullscreenMode() {
            try {
                if (!document.fullscreenElement) { await readerShell.requestFullscreen(); } else { await document.exitFullscreen(); }
            } catch (error) { console.error("[KOBA Reader] Fullscreen request failed.", error); }
        }

        document.addEventListener("fullscreenchange", () => {
            const isFullscreen = document.fullscreenElement === readerShell;
            readerShell.classList.toggle("is-fullscreen", isFullscreen);
            fullscreenButton.setAttribute("aria-pressed", String(isFullscreen));
            fullscreenButton.style.background = isFullscreen ? "#3b82f6" : "#1f2937";
            viewportCard.style.height = isFullscreen ? "min(88vh, 920px)" : "min(78vh, 820px)";
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

        function showNextPage() { if (currentIndex < readerPages.length - 1 && !isTransitioning) { currentIndex += 1; renderPage(); } }
        function showPreviousPage() { if (currentIndex > 0 && !isTransitioning) { currentIndex -= 1; renderPage(); } }

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
    if (!$post) return $template;

    $is_root_bookshelf = is_page('bookshelf') || $post->post_name === 'bookshelf';
    $has_query_asset   = isset($_GET['asset']) && !empty($_GET['asset']);
    $is_single_cpt     = is_singular('koba_publication');

    if ($is_root_bookshelf && !$has_query_asset) {
        return $template; 
    }

    if ($is_single_cpt || ($is_root_bookshelf && $has_query_asset)) {
        $book_id = $post->ID;
        $asset_key = koba_resolve_publication_asset_key(
            $book_id,
            $has_query_asset
                ? wp_unslash($_GET['asset'])
                : ''
        );

        wp_enqueue_style('bloom-style', plugin_dir_url(__FILE__) . 'assets/bloom-style.css', array(), time());
        wp_enqueue_script('jubilee-core-js', plugin_dir_url(__FILE__) . 'assets/jubilee-core.js', array(), time(), true);
        wp_enqueue_script('bloom-player-js', plugin_dir_url(__FILE__) . 'assets/bloom-player.js', array('jubilee-core-js'), time(), true);
        
        // Fully Hydrated Presentation Contract Localization Pass
        $current_user = wp_get_current_user();
        $user_phone = '';
        if ($current_user->ID !== 0) {
            $user_phone = get_user_meta($current_user->ID, 'billing_phone', true)
                       ?: get_user_meta($current_user->ID, 'phone_number', true)
                       ?: '';
        }

        $dashboard_url = koba_get_dashboard_url();
        wp_localize_script(
            'jubilee-core-js',
            'JubileeConfig',
            array(
                'dashboardUrl' => $dashboard_url,
                'apiUrl'       => $dashboard_url . '/api/products/public',
                'checkoutUrl'  => $dashboard_url . '/api/checkout',
                'userPhone'    => sanitize_text_field($user_phone),
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
                <div id="koba-vault-door" class="koba-gate-screen">
                    <h2 style="color: #fff; margin-top: 0;" id="vault-door-message">Verifying Vault Access...</h2>
                    <p style="color: #8b949e; font-size: 0.95rem; line-height: 1.5;">Analyzing core framework signatures.</p>
                    <button id="vault-lock-btn" class="koba-primary-btn" style="display: none;">
                        Unlock Access Key
                    </button>
                </div>

                <div id="bloom-player-wrapper" style="display: none; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0;">
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

            <?php if ($is_local_environment) : ?>
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
