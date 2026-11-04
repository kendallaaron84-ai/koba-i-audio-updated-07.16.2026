<?php
/** Private editorial branch of the existing reader; never a consumer entitlement. */
if ( ! defined( 'ABSPATH' ) ) exit;

function koba_editor_preview_path( $path, $asset, $studio ) {
    return is_string( $path ) && strpos( $path, 'studio/' . $asset . '/' . $studio . '/' ) === 0
        && ! preg_match( '~(?:^|/)\.\.(?:/|$)|[\x00-\x1f\x7f]~', $path );
}

/** Called only inside the existing authenticated, tenant-bound publication writer. */
function koba_prepare_editor_preview_snapshot( $params ) {
    $media_type = $params['type'] ?? '';
    if ( ! in_array( $media_type, array( 'ebook', 'audiobook' ), true ) || ! in_array( $params['status'] ?? '', array( 'draft', 'ready' ), true ) ) return null;
    $asset = (string) ( $params['assetKey'] ?? '' );
    $studio = strtoupper( trim( (string) ( $params['studioKey'] ?? '' ) ) );
    $origin = koba_normalize_gateway_site_origin( $params['targetWpOrigin'] ?? '' );
    $asset_pattern = $media_type === 'ebook' ? '/^ebk_[a-z0-9][a-z0-9_-]{0,139}$/' : '/^abk_[a-z0-9][a-z0-9_-]{0,139}$/';
    if ( ! preg_match( $asset_pattern, $asset ) ||
         $studio !== strtoupper( trim( (string) get_option( 'koba_license_key' ) ) ) ||
         $origin !== koba_normalize_gateway_site_origin( home_url( '/' ) ) ) {
        return new WP_Error( 'koba_preview_binding_invalid', 'Private preview identity is invalid.', array( 'status' => 403 ) );
    }
    $payload = is_array( $params['ebookPayload'] ?? null ) ? $params['ebookPayload'] : array();
    $chapters = ! empty( $payload['chapters'] ) ? $payload['chapters'] : ( $params['chapters'] ?? array() );
    if ( ! is_array( $chapters ) ) return new WP_Error( 'koba_preview_payload_invalid', 'Private preview chapters are invalid.', array( 'status' => 400 ) );
    $snapshot = array( 'assetKey' => $asset, 'studioKey' => $studio, 'origin' => $origin, 'mediaType' => $media_type, 'audio' => array(),
        'grant' => is_string( $payload['privatePreviewGrant'] ?? null ) ? $payload['privatePreviewGrant'] : '',
        'chapters' => array(), 'layoutMode' => 'reflowable', 'images' => array(),
        'authorName' => sanitize_text_field( $params['authorName'] ?? '' ),
        'description' => wp_kses_post( $params['synopsis'] ?? '' ),
        'illustratedPageSettings' => array( 'allowSpreads' => true, 'spreadStart' => 'right', 'pageBackground' => '#111111' ) );
    $settings = is_array( $payload['illustratedPageSettings'] ?? null ) ? $payload['illustratedPageSettings'] : array();
    $snapshot['illustratedPageSettings']['allowSpreads'] = ( $settings['allowSpreads'] ?? true ) !== false;
    $snapshot['illustratedPageSettings']['spreadStart'] = ( $settings['spreadStart'] ?? '' ) === 'left' ? 'left' : 'right';
    if ( preg_match( '/^#[a-f0-9]{6}$/i', $settings['pageBackground'] ?? '' ) ) $snapshot['illustratedPageSettings']['pageBackground'] = $settings['pageBackground'];
    foreach ( $chapters as $index => $chapter ) {
        if ( ! is_array( $chapter ) ) continue;
        $item = array( 'id' => sanitize_text_field( $chapter['id'] ?? 'chapter_' . $index ),
            'title' => sanitize_text_field( $chapter['title'] ?? 'Chapter ' . ( $index + 1 ) ),
            'textContent' => wp_kses_post( $chapter['xhtml'] ?? ( $chapter['html'] ?? ( $chapter['textContent'] ?? ( $chapter['content'] ?? '' ) ) ) ) );
        if ( $media_type === 'audiobook' ) {
            $path = $chapter['storagePath'] ?? '';
            if ( $path === '' ) continue; // Empty workspaces can still be staged privately.
            if ( ! koba_editor_preview_path( $path, $asset, $studio ) ) return new WP_Error( 'koba_preview_audio_invalid', 'Audio must belong to this protected draft.', array( 'status' => 400 ) );
            $key = hash( 'sha256', $path );
            $snapshot['audio'][ $key ] = $path;
            $item['audioKey'] = $key;
            $item['duration'] = max( 0, (float) ( $chapter['duration'] ?? 0 ) );
            $snapshot['chapters'][] = $item;
            continue;
        }
        // Preserve private inline-image references; do not persist signed browser URLs.
        $tags = new WP_HTML_Tag_Processor( $item['textContent'] );
        while ( $tags->next_tag( 'IMG' ) ) {
            $path = $tags->get_attribute( 'data-koba-storage-path' );
            if ( ! koba_editor_preview_path( $path, $asset, $studio ) ) {
                return new WP_Error( 'koba_preview_image_invalid', 'Draft images must belong to this protected asset.', array( 'status' => 400 ) );
            }
            $key = hash( 'sha256', $path );
            $snapshot['images'][ $key ] = $path;
            $tags->set_attribute( 'src', '' );
        }
        $item['textContent'] = $tags->get_updated_html();
        if ( ! empty( $chapter['pages'] ) && is_array( $chapter['pages'] ) ) {
            $snapshot['layoutMode'] = 'illustrated_pages';
            $item['pages'] = array();
            foreach ( $chapter['pages'] as $i => $page ) {
                $path = $page['assetId'] ?? ( $page['storagePath'] ?? '' );
                if ( ! koba_editor_preview_path( $path, $asset, $studio ) ) return new WP_Error( 'koba_preview_image_invalid', 'Illustrated page belongs to another asset.', array( 'status' => 400 ) );
                $key = hash( 'sha256', $path );
                $snapshot['images'][ $key ] = $path;
                $item['pages'][] = array( 'id' => sanitize_text_field( $page['id'] ?? 'page_' . $i ),
                    'imageKey' => $key, 'width' => absint( $page['width'] ?? 0 ), 'height' => absint( $page['height'] ?? 0 ),
                    'alt' => sanitize_text_field( $page['alt'] ?? $item['title'] ), 'chapterPageIndex' => $i, 'position' => $i + 1 );
            }
        }
        $snapshot['chapters'][] = $item;
    }
    return $snapshot;
}

function koba_authorize_editor_preview( $post_id ) {
    $post = get_post( $post_id );
    if ( ! $post || ! in_array( $post->post_type, array( 'page', 'koba_publication' ), true ) ||
         $post->post_status !== 'draft' || ! in_array( get_post_meta( $post_id, '_koba_media_type', true ), array( 'ebook', 'audiobook' ), true ) ) {
        return new WP_Error( 'koba_preview_unavailable', 'Draft preview unavailable.', array( 'status' => 404 ) );
    }
    if ( ! is_user_logged_in() || ! current_user_can( 'edit_post', $post_id ) ) {
        return new WP_Error( 'koba_preview_forbidden', 'Editorial permission required.', array( 'status' => 403 ) );
    }
    $snapshot = get_post_meta( $post_id, '_koba_editor_preview', true );
    $asset = get_post_meta( $post_id, 'assetKey', true );
    $origin = koba_normalize_gateway_site_origin( home_url( '/' ) );
    if ( ! is_array( $snapshot ) || get_option( 'koba_license_status' ) !== 'active' ||
         ( $snapshot['mediaType'] ?? 'ebook' ) !== get_post_meta( $post_id, '_koba_media_type', true ) ||
         ! $asset || $snapshot['assetKey'] !== $asset ||
         ( get_post_meta( $post_id, 'koba_asset_key', true ) && get_post_meta( $post_id, 'koba_asset_key', true ) !== $asset ) ||
         $snapshot['studioKey'] !== strtoupper( trim( (string) get_option( 'koba_license_key' ) ) ) ||
         $snapshot['origin'] !== $origin ||
         koba_normalize_gateway_site_origin( get_option( 'koba_license_associated_website' ) ) !== $origin ) {
        return new WP_Error( 'koba_preview_binding_invalid', 'Draft preview identity mismatch.', array( 'status' => 403 ) );
    }
    return $snapshot;
}

function koba_editor_preview_image_url( $post_id, $key ) {
    return add_query_arg( '_wpnonce', wp_create_nonce( 'wp_rest' ), rest_url( 'kobai/v1/editor-preview/' . $post_id . '/images/' . $key . '.png' ) );
}
function koba_editor_preview_audio_url( $post_id, $key ) {
    return add_query_arg( '_wpnonce', wp_create_nonce( 'wp_rest' ), rest_url( 'kobai/v1/editor-preview/' . $post_id . '/audio/' . $key ) );
}
function koba_editor_preview_book( $post_id, $asset ) {
    if ( ! is_preview() ) return null;
    $snapshot = koba_authorize_editor_preview( $post_id );
    if ( is_wp_error( $snapshot ) || $snapshot['assetKey'] !== $asset ) return null;
    $chapters = $snapshot['chapters'];
    foreach ( $chapters as &$chapter ) {
        if ( ( $snapshot['mediaType'] ?? 'ebook' ) === 'audiobook' ) {
            if ( empty( $chapter['audioKey'] ) || ! isset( $snapshot['audio'][ $chapter['audioKey'] ] ) ) return null;
            $chapter['url'] = koba_editor_preview_audio_url( $post_id, $chapter['audioKey'] );
            unset( $chapter['audioKey'] );
            continue;
        }
        $tags = new WP_HTML_Tag_Processor( $chapter['textContent'] );
        while ( $tags->next_tag( 'IMG' ) ) {
            $key = hash( 'sha256', (string) $tags->get_attribute( 'data-koba-storage-path' ) );
            if ( isset( $snapshot['images'][ $key ] ) ) $tags->set_attribute( 'src', koba_editor_preview_image_url( $post_id, $key ) );
        }
        $chapter['textContent'] = $tags->get_updated_html();
        foreach ( $chapter['pages'] ?? array() as $i => $page ) {
            $chapter['pages'][ $i ]['url'] = koba_editor_preview_image_url( $post_id, $page['imageKey'] );
            unset( $chapter['pages'][ $i ]['imageKey'] );
        }
    }
    unset( $chapter );
    return array( 'assetKey' => $asset, 'studioKey' => $snapshot['studioKey'], 'mediaType' => $snapshot['mediaType'] ?? 'ebook', 'title' => get_the_title( $post_id ), 'authorName' => $snapshot['authorName'], 'description' => $snapshot['description'],
        'chapters' => $chapters, 'layoutMode' => $snapshot['layoutMode'], 'illustratedPageSettings' => $snapshot['illustratedPageSettings'] );
}

add_action( 'rest_api_init', function () {
    register_rest_route( 'kobai/v1', '/editor-preview/(?P<post_id>\d+)/audio/(?P<media>[a-f0-9]{64})', array(
        'methods' => 'GET',
        'permission_callback' => function ( $request ) {
            $context = koba_authorize_editor_preview( absint( $request['post_id'] ) );
            return is_wp_error( $context ) ? $context : true;
        },
        'callback' => 'koba_serve_editor_preview_audio',
    ) );
    register_rest_route( 'kobai/v1', '/editor-preview/(?P<post_id>\d+)/images/(?P<image>[a-f0-9]{64})\.png', array(
        'methods' => 'GET',
        'permission_callback' => function ( $request ) {
            $context = koba_authorize_editor_preview( absint( $request['post_id'] ) );
            return is_wp_error( $context ) ? $context : true;
        },
        'callback' => 'koba_serve_editor_preview_image',
    ) );
} );

/** Bound each response so long editorial recordings do not enter PHP memory at once. */
function koba_editor_preview_audio_range( $value, $size ) {
    $value = (string) $value;
    $start = 0;
    $end = $size - 1;
    if ( $size <= 0 ) return new WP_Error( 'koba_preview_audio_range', 'Audio range unavailable.', array( 'status' => 416 ) );
    if ( $value !== '' ) {
        if ( ! preg_match( '/^bytes=(\d*)-(\d*)$/', $value, $match ) || ( $match[1] === '' && $match[2] === '' ) ) return new WP_Error( 'koba_preview_audio_range', 'Audio range unavailable.', array( 'status' => 416 ) );
        if ( $match[1] === '' ) {
            if ( (int) $match[2] <= 0 ) return new WP_Error( 'koba_preview_audio_range', 'Audio range unavailable.', array( 'status' => 416 ) );
            $start = max( 0, $size - (int) $match[2] );
        } else {
            $start = (int) $match[1];
            if ( $match[2] !== '' ) $end = min( $end, (int) $match[2] );
        }
    }
    if ( $start >= $size || $end < $start ) return new WP_Error( 'koba_preview_audio_range', 'Audio range unavailable.', array( 'status' => 416 ) );
    return array( $start, min( $end, $start + 4 * 1024 * 1024 - 1 ) );
}

function koba_serve_editor_preview_audio( $request ) {
    $post_id = absint( $request['post_id'] );
    $context = koba_authorize_editor_preview( $post_id );
    if ( is_wp_error( $context ) ) return $context;
    $key = $request['media'];
    if ( ( $context['mediaType'] ?? '' ) !== 'audiobook' || empty( $context['audio'][ $key ] ) || empty( $context['grant'] ) ) return new WP_Error( 'koba_preview_audio_unavailable', 'Draft audio unavailable.', array( 'status' => 404 ) );
    $response = wp_remote_post( koba_get_dashboard_url() . '/api/media/wordpress-preview', array(
        'timeout' => 15, 'redirection' => 0, 'headers' => array( 'Authorization' => 'Bearer ' . $context['grant'], 'Content-Type' => 'application/json' ),
        'body' => wp_json_encode( array( 'kind' => 'audio', 'postId' => $post_id, 'storagePath' => $context['audio'][ $key ] ) ),
    ) );
    if ( is_wp_error( $response ) || wp_remote_retrieve_response_code( $response ) !== 200 ) return new WP_Error( 'koba_preview_audio_unavailable', 'Save and sync this draft to renew private audio access.', array( 'status' => 403 ) );
    $data = json_decode( wp_remote_retrieve_body( $response ), true );
    $parts = wp_parse_url( $data['url'] ?? '' );
    if ( ! is_array( $parts ) || ( $parts['scheme'] ?? '' ) !== 'https' || ( $parts['host'] ?? '' ) !== 'storage.googleapis.com' || isset( $parts['user'] ) || isset( $parts['port'] ) ||
         ! preg_match( '~^audio/(mpeg|mp3|mp4|aac|wav|x-wav|wave|flac|x-flac|ogg)$~', $data['contentType'] ?? '' ) || ! is_int( $data['size'] ?? null ) ) return new WP_Error( 'koba_preview_audio_unavailable', 'Draft audio unavailable.', array( 'status' => 403 ) );
    $range = koba_editor_preview_audio_range( $request->get_header( 'range' ), $data['size'] );
    if ( is_wp_error( $range ) ) return $range;
    list( $start, $end ) = $range;
    $media = wp_safe_remote_get( $data['url'], array( 'timeout' => 20, 'redirection' => 0, 'limit_response_size' => 4 * 1024 * 1024,
        'headers' => array( 'Range' => 'bytes=' . $start . '-' . $end ),
    ) );
    if ( is_wp_error( $media ) || wp_remote_retrieve_response_code( $media ) !== 206 ||
         wp_remote_retrieve_header( $media, 'content-range' ) !== 'bytes ' . $start . '-' . $end . '/' . $data['size'] ) return new WP_Error( 'koba_preview_audio_unavailable', 'Draft audio unavailable.', array( 'status' => 404 ) );
    $bytes = wp_remote_retrieve_body( $media );
    if ( strlen( $bytes ) !== $end - $start + 1 ) return new WP_Error( 'koba_preview_audio_unavailable', 'Draft audio unavailable.', array( 'status' => 404 ) );
    nocache_headers();
    status_header( 206 );
    header( 'Cache-Control: private, no-store, max-age=0' );
    header( 'X-Content-Type-Options: nosniff' );
    header( 'Content-Type: ' . $data['contentType'] );
    header( 'Accept-Ranges: bytes' );
    header( 'Content-Range: bytes ' . $start . '-' . $end . '/' . $data['size'] );
    header( 'Content-Length: ' . strlen( $bytes ) );
    if ( strtoupper( $request->get_method() ) !== 'HEAD' ) echo $bytes;
    exit;
}

function koba_serve_editor_preview_image( $request ) {
    $post_id = absint( $request['post_id'] );
    $context = koba_authorize_editor_preview( $post_id );
    if ( is_wp_error( $context ) ) return $context;
    $key = $request['image'];
    if ( empty( $context['images'][ $key ] ) || empty( $context['grant'] ) ) return new WP_Error( 'koba_preview_image_unavailable', 'Draft image unavailable.', array( 'status' => 404 ) );
    $response = wp_remote_post( koba_get_dashboard_url() . '/api/media/wordpress-preview', array(
        'timeout' => 15, 'redirection' => 0, 'headers' => array( 'Authorization' => 'Bearer ' . $context['grant'], 'Content-Type' => 'application/json' ),
        'body' => wp_json_encode( array( 'postId' => $post_id, 'storagePath' => $context['images'][ $key ] ) ),
    ) );
    if ( is_wp_error( $response ) || wp_remote_retrieve_response_code( $response ) !== 200 ) return new WP_Error( 'koba_preview_image_unavailable', 'Draft image unavailable. Save and sync the draft to renew editorial access.', array( 'status' => 403 ) );
    $data = json_decode( wp_remote_retrieve_body( $response ), true );
    $url = $data['url'] ?? '';
    $parts = wp_parse_url( $url );
    // Never follow a caller-provided URL or expose the signed storage URL to the browser.
    if ( ! is_array( $parts ) || ( $parts['scheme'] ?? '' ) !== 'https' || ( $parts['host'] ?? '' ) !== 'storage.googleapis.com' || isset( $parts['user'] ) || isset( $parts['port'] ) ) return new WP_Error( 'koba_preview_image_unavailable', 'Draft image unavailable.', array( 'status' => 403 ) );
    $image = wp_safe_remote_get( $url, array( 'timeout' => 20, 'redirection' => 0, 'limit_response_size' => 12 * 1024 * 1024 ) );
    if ( is_wp_error( $image ) || wp_remote_retrieve_response_code( $image ) !== 200 ) return new WP_Error( 'koba_preview_image_unavailable', 'Draft image unavailable.', array( 'status' => 404 ) );
    $bytes = wp_remote_retrieve_body( $image );
    $info = @getimagesizefromstring( $bytes );
    if ( ! $info || ! in_array( $info['mime'], array( 'image/png', 'image/jpeg', 'image/webp', 'image/gif' ), true ) ) return new WP_Error( 'koba_preview_image_unavailable', 'Draft image unavailable.', array( 'status' => 415 ) );
    nocache_headers();
    header( 'Cache-Control: private, no-store, max-age=0' );
    header( 'X-Content-Type-Options: nosniff' );
    header( 'Content-Type: ' . $info['mime'] );
    echo $bytes; // Authorized binary image, never HTML or a public redirect.
    exit;
}

add_filter( 'template_include', function ( $template ) {
    global $post;
    if ( ! is_preview() || ! is_main_query() || ! $post instanceof WP_Post || get_queried_object_id() !== (int) $post->ID ||
         ! in_array( $post->post_type, array( 'page', 'koba_publication' ), true ) ||
         ! in_array( get_post_meta( $post->ID, '_koba_media_type', true ), array( 'ebook', 'audiobook' ), true ) ) return $template;
    $context = koba_authorize_editor_preview( $post->ID );
    if ( is_wp_error( $context ) ) wp_die( esc_html( $context->get_error_message() ), 'Private preview unavailable', array( 'response' => 403 ) );
    if ( isset( $_GET['asset'] ) && wp_unslash( $_GET['asset'] ) !== $context['assetKey'] ) wp_die( 'Preview asset mismatch.', '', array( 'response' => 403 ) );
    nocache_headers();
    header( 'Cache-Control: private, no-store, max-age=0' );
    header( 'X-Robots-Tag: noindex, nofollow, noarchive' );
    header( 'Referrer-Policy: no-referrer' );
    if ( ( $context['mediaType'] ?? 'ebook' ) === 'ebook' ) add_action( 'wp_enqueue_scripts', function () {
        foreach ( array( 'jubilee-core-js', 'bloom-player-js', 'koba-reader-handoff-js' ) as $handle ) wp_dequeue_script( $handle );
    }, 999 );
    ?><!doctype html><html <?php language_attributes(); ?>><head><meta charset="<?php bloginfo( 'charset' ); ?>"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title><?php echo esc_html( get_the_title( $post->ID ) ); ?> — Private preview</title><style>html,body{margin:0!important;height:100%;overflow:hidden}#wpadminbar{display:none!important}</style><?php wp_head(); ?></head><body><?php
    if ( ( $context['mediaType'] ?? 'ebook' ) === 'audiobook' ) koba_render_bloom_player_ui( $post->ID, $context['assetKey'] );
    else koba_render_sovereign_reader_engine( $post->ID, $context['assetKey'] );
    wp_footer();
    ?></body></html><?php
    exit;
}, 998 );
