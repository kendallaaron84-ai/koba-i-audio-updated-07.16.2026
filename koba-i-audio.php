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

// 🎯 This captures the <input type="hidden" name="action" value="koba_activate_license">
add_action('admin_post_koba_activate_license', 'koba_handle_license_submit');

function koba_handle_license_submit() {
    // Check privileges
    if (!current_user_can('manage_options')) {
        wp_die('Unauthorized user context.');
    }

    // Capture and sanitize the incoming key string
    if (isset($_POST['koba_key'])) {
        $new_key = sanitize_text_field($_POST['koba_key']);
        update_option('koba_license_key', trim($new_key));
        
        // Wipe local validation status to force a fresh remote check
        update_option('koba_license_status', 'inactive');
    }

    // Redirect cleanly back to the license page layout view
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
    
    // 🚀 NEW: Catch the E-Book parameters sent from Next.js
    $cover_art   = esc_url_raw($params['coverUrl'] ?? ($params['coverArt'] ?? ''));
    $bg_image    = esc_url_raw($params['bgImageUrl'] ?? ($params['bgImage'] ?? ''));
    $media_type  = sanitize_text_field($params['type'] ?? 'audio');
    $price       = sanitize_text_field($params['price'] ?? '0.00');
    
    // 🚀 REST RESTORATION FOR PLAYER CANVAS
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
    // 🚀 REST PARSER ALIGNMENT IN KOBA-I-AUDIO.PHP
    if (!empty($params['chapters']) && is_array($params['chapters'])) {
        $final_playlist = [];
        foreach ($params['chapters'] as $index => $ch) {
            // Fallback safety for media URLs
            $track_url = $ch['url'] ?? ($ch['audioUrl'] ?? ($ch['streamUrl'] ?? ($ch['src'] ?? '')));
            
            // 🎯 THE FIX: Explicitly extract and sanitize textContent from Firestore schema
            $chapter_text = $ch['textContent'] ?? ($ch['content'] ?? ($ch['text'] ?? ''));

            $final_playlist[] = [
                'id'          => !empty($ch['id']) ? sanitize_text_field($ch['id']) : 'ch_' . ($index + 1),
                'title'       => !empty($ch['title']) ? sanitize_text_field($ch['title']) : 'Chapter ' . ($index + 1),
                'url'         => esc_url_raw($track_url),
                'src'         => esc_url_raw($track_url),
                'audioUrl'    => esc_url_raw($track_url),
                'textContent' => wp_kses_post($chapter_text), // Preserves text formatting rows perfectly
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

    // 🚀 NEW: Save the intercepted parameters directly into the WordPress Post Meta
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

    // CREATE THE FRONTEND PLAYER CANVAS PAGE
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

    // 🚀 THE FIX: Mirror the E-Book data straight to the Frontend Page so the shortcode can read it!
    update_post_meta($page_id, '_koba_cover_art_url', $cover_art);
    update_post_meta($page_id, '_koba_bg_image_url', $bg_image);
    update_post_meta($page_id, '_koba_media_type', $media_type);
    update_post_meta($page_id, '_koba_price', $price);
    // 🚀 REST RESTORATION FOR PLAYER CANVAS
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

/* ===============================================================   6. COMMAND CENTER SYNC ENGINE & ADMIN
 ========================================================================= */
if (!function_exists('koba_get_dashboard_url')) {
    function koba_get_dashboard_url() {
        $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
        $referer = $_SERVER['HTTP_REFERER'] ?? '';
        $host = $_SERVER['HTTP_HOST'] ?? '';
        
        // If we detect ngrok in host, origin, or referer, route to the active ngrok tunnel
        if (strpos($origin, 'ngrok-free.dev') !== false || strpos($referer, 'ngrok-free.dev') !== false || strpos($host, 'ngrok-free.dev') !== false) {
            return 'https://barbecue-scuff-scale.ngrok-free.dev';
        }

        // Force port 3000 as Next.js is running there, preventing ERR_CONNECTION_REFUSED on 3002
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

/* =========================================================================
   6. COMMAND CENTER SYNC ENGINE & ADMIN LICENSE MANAGEMENT
========================================================================= */

// 🎯 FIX: Hook the registration function name cleanly to the menu action
add_action('admin_menu', 'koba_register_license_page');
function koba_register_license_page() {
    // This tells WordPress to use 'koba_render_license_page' to display the UI HTML
    add_menu_page(
        'Jubilee Studio License', 
        'Jubilee Activation', 
        'manage_options', 
        'koba-license', 
        'koba_render_license_page', // 💡 Callback function that outputs the HTML form
        'dashicons-lock', 
        2
    );
}

// Ensure this function name matches the string used inside add_menu_page exactly
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

// RESTORED: Core capability enforcer prevents admin backend from crashing
function koba_enforce_feature_capability($required_cap, $display_callback) {
    $status = get_option('koba_license_status', 'inactive');
    $capabilities = get_option('koba_license_capabilities', []);

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

/* =========================================================================
    🆕 JUBILEE PLATFORM SHORTCODE MATRIX
========================================================================= */
add_action( 'wp_enqueue_scripts', 'koba_load_vault_assets' );
function koba_load_vault_assets() {
    // 1. Enqueue Styles & Scripts with cache-busting timestamps using your root constant
    wp_enqueue_style( 'bloom-style', KOBA_IA_URL . 'assets/bloom-style.css', array(), time() );
    wp_enqueue_script( 'jubilee-core-js', KOBA_IA_URL . 'assets/jubilee-core.js', array(), time(), true );
    wp_enqueue_script( 'bloom-player-js', KOBA_IA_URL . 'assets/bloom-player.js', array('jubilee-core-js'), time(), true );

    // 2. Fetch the current logged-in user context to map dynamic phone parameters
    $current_user = wp_get_current_user();
    $user_phone   = '';
    
    if ( $current_user->ID !== 0 ) {
        // Pulls custom phone records from Firebase database sync or WordPress billing metadata fields
        $user_phone = get_user_meta($current_user->ID, 'billing_phone', true) 
                   ?: get_user_meta($current_user->ID, 'phone_number', true) 
                   ?: '';
    }

    // 3. Inject active dynamic properties straight into the front-end JS canvas environment
    $dashboard_url = koba_get_dashboard_url();
    wp_localize_script( 'jubilee-core-js', 'JubileeConfig', array(
        'dashboardUrl' => $dashboard_url,
        'apiUrl'       => $dashboard_url . '/api/products/public',
        'checkoutUrl'  => $dashboard_url . '/api/checkout',
        'userPhone'    => sanitize_text_field($user_phone)
    ));
}

add_shortcode('jubilee_catalog', 'render_jubilee_matrix_buyer_catalog');
add_shortcode('koba_bloom_player', 'koba_render_bloom_player_ui');

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

add_filter('query_vars', 'koba_register_query_vars');
function koba_register_query_vars($vars) {
    $vars[] = 'asset';
    return $vars;
}

/* =========================================================================
   RESTORED: CENTRAL PLAYER CANVAS RENDERER & INTERCEPTOR (Upgraded to Glassmorphism)
========================================================================= */
function koba_render_sovereign_player_engine($post_id) {
    // 🎯 FIXED: Pulls the correct database footprint keys matching your automated schema
    $chapters_json   = get_post_meta($post_id, '_koba_chapters_data', true);
    $chapters        = koba_get_chapters_from_json($chapters_json);
    
    // Checks standard meta, fallback meta, and adds your active Firebase storage link as an absolute guarantee
    $cover_art       = get_post_meta($post_id, '_koba_cover_art', true)
                    ?: get_post_meta($post_id, 'coverArtUrl', true)
                    ?: 'https://firebasestorage.googleapis.com/v0/b/jubilee-command-center---dev.firebasestorage.app/o/assets%2Fabk_the-case-of-the-missing-carrot_coverUrl_500%20Missing%20Carrot%20-%20Cover%20Art.png?alt=media&token=dde73f35-147d-409c-9d11-e785f3b9f1cc';

    $bg_image        = get_post_meta($post_id, '_koba_bg_image', true)
                    ?: get_post_meta($post_id, 'bgImageUrl', true)
                    ?: 'https://firebasestorage.googleapis.com/v0/b/jubilee-command-center---dev.firebasestorage.app/o/assets%2Fabk_the-case-of-the-missing-carrot_bgImageUrl_bgMissing%20Carrot.jpg?alt=media&token=0d81b237-2ee8-44fc-afc5-3b80e0fa6512';

    $bg_color        = get_post_meta($post_id, '_koba_bg_color', true) ?: '#070a0f';
    $card_opacity    = get_post_meta($post_id, '_koba_card_opacity', true) ?: 'rgba(13, 17, 23, 0.7)';
    $media_type      = get_post_meta($post_id, '_koba_media_type', true) ?: 'audiobook';
    $read_along_json = get_post_meta($post_id, '_koba_read_along_transcript', true);
    $transcript      = json_decode($read_along_json, true) ?: null;

    $audio_url = get_post_meta($post_id, '_koba_audio_url', true) 
              ?: get_post_meta($post_id, 'audioUrl', true) 
              // 🎯 FIXED: Hardwired fallback now accurately hits your live timestamp instance
              ?: 'https://firebasestorage.googleapis.com/v0/b/jubilee-command-center---dev.firebasestorage.app/o/studio%2Fabk_the-case-of-the-missing-carrot%2F1783716402158_Missing_Carrot_final.mp3?alt=media';

    // If the database has no custom chapters yet, inject the fallback track so the player operates instantly
    if (empty($chapters)) {
        $chapters = [
            [
                "id" => "ch_1",
                "title" => "Chapter 1: The Disappearance",
                "mediaUrl" => $audio_url ?: "https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3",
                "duration" => 372
            ]
        ];
    }

    ?>
    <script>
    // 🎯 FIXED: The function now accepts an optional runtime data override
    window.bootKobaPlayer = function(overrideData) {
        <?php 
        $player_data = [
            'title'       => get_the_title($post_id) ?: 'The Case of the Missing Carrot',
            'mediaType'   => $media_type,
            'coverUrl'    => esc_url_raw($cover_art),
            'coverArtUrl' => esc_url_raw($cover_art),
            'bgImage'     => esc_url_raw($bg_image),
            'restUrl'     => esc_url_raw(rest_url('koba-ia/v2')),
            'nonce'       => wp_create_nonce('wp_rest'),
            'theme'       => [
                'backgroundColor' => $bg_color,
                'backgroundImage' => esc_url_raw($bg_image),
                'cardBackground'  => $card_opacity,
                'coverUrl'        => esc_url_raw($cover_art)
            ],
            'logoUrl'     => plugin_dir_url(__FILE__) . 'assets/koba-logo-text.png',
            'chapters'    => $chapters,
            'transcript'  => $transcript
        ];
        ?>

        // 🚀 THE SAFETY GATE: Use verified cloud assets if passed, otherwise use server fallback
        if (overrideData) {
            window.kobaData = overrideData;
        } else if (!window.kobaData) {
            window.kobaData = <?php echo wp_json_encode($player_data); ?>;        
        }
        
        const rootContainer = document.getElementById("koba-app-viewport");
        if (rootContainer && window.kobaData.theme) {
            rootContainer.style.backgroundColor = window.kobaData.theme.backgroundColor;
            if (window.kobaData.theme.backgroundImage) {
                const escapedBg = window.kobaData.theme.backgroundImage.replace(/'/g, "\\'");
                rootContainer.style.backgroundImage = `url('${escapedBg}')`;
                rootContainer.style.backgroundSize = 'cover';
                rootContainer.style.backgroundPosition = 'center';
            }
        }
        if (typeof renderBloomRoot === "function") { renderBloomRoot(); }
    };
    </script>
    <div id="koba-bloom-root" style="width: 100%; height: 100%; min-height: 100vh; position: relative; z-index: 5;"></div>
    <?php
}

function koba_render_bloom_player_ui() {
    $asset_key = get_query_var('asset') ?: (isset($_GET['asset']) ? sanitize_text_field($_GET['asset']) : '');
    if (empty($asset_key)) return '<div style="text-align:center; padding:50px;"><h3>No book selected. Return to your library.</h3></div>';

    $current_page_id = get_the_ID();
    $current_user_email = is_user_logged_in() ? wp_get_current_user()->user_email : '';

    $resolved_post_id = $current_page_id;
    if (!empty($asset_key)) {
        $pub_query = new WP_Query(array(
            'post_type'      => 'koba_publication',
            'meta_key'       => 'koba_asset_key',
            'meta_value'     => $asset_key,
            'posts_per_page' => 1,
            'post_status'    => 'any'
        ));
        if ($pub_query->have_posts()) {
            $resolved_post_id = $pub_query->posts[0]->ID;
        }
    }

    // 🚀 THE INTEGRATED GATEKEEPER
    // We check the post meta for price. If it's 0 or less, we consider it free-access.
    $book_price = get_post_meta($resolved_post_id, '_koba_price', true); 
    $is_free = (floatval($book_price) <= 0);

    ob_start();
    ?>
    <div id="koba-app-viewport" style="position:relative; width:100%; min-height:80vh; background:#070a0f; border-radius:12px; overflow:hidden;">
        
        <?php if (!$is_free): ?>
        <div id="koba-vault-door" style="text-align: center; padding: 100px 20px; background: #0d1117; color:#fff;">
          <h2 style="font-family: system-ui; color: #fff;" id="vault-door-message">This Audiobook is Locked in the Vault</h2>
          <button onclick="window.openSMSVerificationModal('<?php echo esc_js($asset_key) ?: 'abk_the-case-of-the-missing-carrot'; ?>')" id="vault-lock-btn" class="koba-primary-btn" style="display: none;">
            Unlock Access Key
        </button>
        </div>
        <?php endif; ?>

        <div id="bloom-player-wrapper" style="display: <?php echo $is_free ? 'block' : 'none'; ?>; width: 100%; height: 100%;">
            <?php koba_render_sovereign_player_engine($resolved_post_id); ?>
        </div>
    </div>

    <script>
    document.addEventListener("DOMContentLoaded", function() {
        // Only run auth logic if it's NOT a free book
        const isFree = <?php echo $is_free ? 'true' : 'false'; ?>;
        
        if (isFree) {
            if (typeof window.bootKobaPlayer === "function") window.bootKobaPlayer();
        } else {
            // Your existing verification logic only for paid titles
            const urlParams = new URLSearchParams(window.location.search);
            const isSuccess = urlParams.get('success') === 'true';
            const assetKey = "<?php echo esc_js($asset_key); ?>";
            const readerEmail = "<?php echo esc_js($current_user_email); ?>";
            
            if (isSuccess || readerEmail) {
                if (isSuccess) localStorage.setItem(`koba_vault_unlocked_${assetKey}`, "true");
                document.getElementById("koba-vault-door").style.display = "none";
                document.getElementById("bloom-player-wrapper").style.display = "block";
                if (typeof window.bootKobaPlayer === "function") window.bootKobaPlayer();
            }
        }
    });
    </script>
    <?php
    return ob_get_clean();
}

/* =========================================================================
   🛡️ REALIGNED SOVEREIGN APP CANVAS OVERRIDE: SMART GATE MATRIX
========================================================================= */
add_filter('template_include', 'koba_enforce_clean_application_canvas', 999);
function koba_enforce_clean_application_canvas($template) {
    global $post;
    
    // Safety exit check
    if (!$post) return $template;

    // 🎯 CHRONOLOGICAL GATEWAY TRACKING 
    $is_root_bookshelf = is_page('bookshelf') || $post->post_name === 'bookshelf';
    $has_query_asset   = isset($_GET['asset']) && !empty($_GET['asset']);
    $is_single_cpt     = is_singular('koba_publication');

    // RULE 1: If it's the root bookshelf page and NO explicit asset query parameter is provided,
    // let it drop down to your standard theme rendering engine so it displays the library storefront matrix.
    if ($is_root_bookshelf && !$has_query_asset) {
        return $template; 
    }

    // RULE 2: Only intercept if we are on a single CPT view OR explicit asset query param parsing is requested
    if ($is_single_cpt || ($is_root_bookshelf && $has_query_asset)) {
        
        $book_id = $post->ID;
        
        // Resolve asset key from post metadata or parameter strings safely
        $asset_key = get_post_meta($book_id, 'koba_asset_key', true) 
                  ?: get_post_meta($book_id, 'assetKey', true) 
                  ?: ($has_query_asset ? sanitize_text_field($_GET['asset']) : '');
                  
        $asset_key = trim($asset_key);
        $current_user_email = is_user_logged_in() ? wp_get_current_user()->user_email : '';

        // Safely enqueue asset paths
        wp_enqueue_style('bloom-style', plugin_dir_url(__FILE__) . 'assets/bloom-style.css', array(), time());
        wp_enqueue_script('jubilee-core-js', plugin_dir_url(__FILE__) . 'assets/jubilee-core.js', array(), time(), true);
        wp_enqueue_script('bloom-player-js', plugin_dir_url(__FILE__) . 'assets/bloom-player.js', array('jubilee-core-js'), time(), true);
        
        $dashboard_url = koba_get_dashboard_url();
        wp_localize_script('jubilee-core-js', 'JubileeConfig', array(
            'apiUrl'      => $dashboard_url . '/api/products/public',
            'checkoutUrl' => $dashboard_url . '/api/checkout'
        ));

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
                    <button onclick="window.openSMSVerificationModal('<?php echo esc_js($asset_key); ?>')" id="vault-lock-btn" class="koba-primary-btn" style="display: none;">
                        Unlock Access Key
                    </button>
                </div>

                <div id="bloom-player-wrapper" style="display: none; width: 100vw; height: 100vh; position: absolute; top: 0; left: 0;">
                    <?php koba_render_sovereign_player_engine($book_id); ?>
                </div>
            </div>

            <script>
            document.addEventListener("DOMContentLoaded", function() {
                const urlParams = new URLSearchParams(window.location.search); 
                const isSuccess = urlParams.get('success') === 'true'; 

                // 🚀 SMART PARSING RECOVERY CHAIN
                let detectedAssetKey = urlParams.get('asset') || "";
                if (!detectedAssetKey) {
                    const pathSegments = window.location.pathname.split('/').filter(Boolean);
                    const potentialSlug = pathSegments[pathSegments.length - 1] || "";
                    if (potentialSlug.startsWith('abk_') || potentialSlug.startsWith('ebk_')) {
                        detectedAssetKey = potentialSlug;
                    }
                }

                const assetKey = detectedAssetKey || "<?php echo esc_js($asset_key); ?>"; 
                const readerEmail = "<?php echo esc_js($current_user_email); ?>"; 
                const centralDashboardUrl = "http://localhost:3000"; 
                const messageEl = document.getElementById("vault-door-message"); 
                const buttonEl = document.getElementById("vault-lock-btn"); 
                
                const activeStudioKey = "MOCK_DEVELOPMENT_KEY"; 
                const localUnlockToken = localStorage.getItem(`koba_vault_unlocked_${assetKey}`); 

                window.openSMSVerificationModal = function(incomingAssetKey) {
                    const targetAsset = incomingAssetKey || assetKey;
                    const activeReaderPhone = (typeof JubileeConfig !== "undefined" && JubileeConfig.userPhone) ? JubileeConfig.userPhone : "";
                    if (messageEl) messageEl.innerText = "📱 Entering Secure SMS Gateway..."; 
                    if (typeof window.triggerUnifiedCheckout === "function") {
                        window.triggerUnifiedCheckout(targetAsset, activeStudioKey, activeReaderPhone);
                    } else {
                        const drawer = document.getElementById("koba-sms-verification-drawer"); 
                        if (drawer) drawer.style.display = "block"; 
                    }
                };

                if (localUnlockToken === "true" || isSuccess) {
                    if (isSuccess) localStorage.setItem(`koba_vault_unlocked_${assetKey}`, "true");
                    const door = document.getElementById("koba-vault-door");
                    if (door) door.remove();
                    document.getElementById("bloom-player-wrapper").style.display = "block";
                    if (typeof window.bootKobaPlayer === "function") {
                        window.bootKobaPlayer(window.kobaData || null);
                    }
                    return;
                }

                if (!readerEmail) {
                    if (messageEl) messageEl.innerText = "🔒 Content Restricted";
                    if (buttonEl) {
                        buttonEl.innerText = "Log In / Verify Credentials";
                        buttonEl.style.display = "inline-block";
                    }
                    return;
                }

                fetch(centralDashboardUrl + "/api/verify-entitlement", {
                    method: "POST",
                    headers: { 
                        "Content-Type": "application/json",
                        "X-Studio-Key": activeStudioKey 
                    },
                    body: JSON.stringify({ 
                        userEmail: readerEmail,
                        assetKey: assetKey,     
                        assetId: assetKey, 
                        domain: window.location.origin 
                    })
                })
                .then(res => res.json())
                .then(auth => {
                    if (auth.authorized) {
                        localStorage.setItem(`koba_vault_unlocked_${assetKey}`, "true");

                        if (!window.kobaData) {
                            window.kobaData = {
                                title: auth.title || "Sovereign Publication",
                                mediaType: "audiobook",
                                chapters: []
                            };
                        }

                        if (auth.mediaUrl || auth.audioUrl) {
                            const targetUrl = auth.mediaUrl || auth.audioUrl;
                            if (!window.kobaData.chapters || window.kobaData.chapters.length === 0) {
                                window.kobaData.chapters = [{ id: "ch_1", title: "Chapter 1", duration: 372 }];
                            }
                            if (window.kobaData.chapters[0]) {
                                window.kobaData.chapters[0].mediaUrl = targetUrl;
                                window.kobaData.chapters[0].audioUrl = targetUrl;
                                window.kobaData.chapters[0].url      = targetUrl;
                            }
                        }
                        if (auth.chapters && auth.chapters.length > 0) {
                            window.kobaData.chapters = auth.chapters;
                        }

                        const door = document.getElementById("koba-vault-door");
                        if (door) door.remove();
                        document.getElementById("bloom-player-wrapper").style.display = "block";
                        
                        if (typeof window.bootKobaPlayer === "function") {
                            window.bootKobaPlayer(window.kobaData); 
                        }
                    } else {
                        if (messageEl) messageEl.innerText = "🔒 Access Key Required";
                        if (buttonEl) {
                            buttonEl.innerText = "Authorize Device via SMS";
                            buttonEl.style.display = "inline-block";
                        }
                    }
                })
                .catch(() => { 
                    if (messageEl) messageEl.innerText = "⚠️ Entitlement verification check dropped."; 
                });
            });
            </script>
            <?php wp_footer(); ?>
        </body>
        </html>
        <?php
        exit;
    }
    return $template;
}

// 🚀 SECURE COMPLIANCE ANCHOR: Force-hook shortcode generation directly to the initialization chain
add_action('plugins_loaded', function() {
    $shortcode_path = plugin_dir_path( __FILE__ ) . 'includes/shortcodes-v2.php';
    if ( file_exists( $shortcode_path ) ) {
        require_once $shortcode_path;
    }
});