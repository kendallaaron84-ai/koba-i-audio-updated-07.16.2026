<?php
/**
 * Authentication and authorization boundary for publication writes received
 * from the KOBA-I WordPress egress gateway.
 */

if ( ! defined( 'ABSPATH' ) ) {
    exit;
}

function koba_mark_gateway_application_password_authentication( $user, $application_password_item ) {
    unset( $application_password_item );
    $GLOBALS['koba_gateway_application_password_user_id'] = isset( $user->ID )
        ? (int) $user->ID
        : 0;
}
add_action(
    'application_password_did_authenticate',
    'koba_mark_gateway_application_password_authentication',
    10,
    2
);

function koba_normalize_gateway_site_origin( $value ) {
    $parts = parse_url( trim( (string) $value ) );
    if ( ! is_array( $parts ) || empty( $parts['scheme'] ) || empty( $parts['host'] ) ) {
        return '';
    }
    $scheme = strtolower( (string) $parts['scheme'] );
    if ( ! in_array( $scheme, array( 'http', 'https' ), true ) ) {
        return '';
    }
    $host = strtolower( rtrim( (string) $parts['host'], '.' ) );
    $port = isset( $parts['port'] ) ? ':' . (int) $parts['port'] : '';
    return $scheme . '://' . $host . $port;
}

function koba_gateway_permission_error( $code, $message, $status ) {
    return new WP_Error( $code, $message, array( 'status' => $status ) );
}

function koba_authorize_gateway_publication_write( $request ) {
    $current_user = wp_get_current_user();
    $current_user_id = isset( $current_user->ID ) ? (int) $current_user->ID : 0;
    $application_password_user_id = isset( $GLOBALS['koba_gateway_application_password_user_id'] )
        ? (int) $GLOBALS['koba_gateway_application_password_user_id']
        : 0;

    if (
        $current_user_id <= 0 ||
        $application_password_user_id <= 0 ||
        $application_password_user_id !== $current_user_id
    ) {
        return koba_gateway_permission_error(
            'koba_gateway_authentication_required',
            'Authenticated KOBA-I gateway credentials are required.',
            401
        );
    }

    if (
        get_option( 'koba_license_status' ) !== 'active' ||
        trim( (string) get_option( 'koba_license_key' ) ) === ''
    ) {
        return koba_gateway_permission_error(
            'koba_gateway_site_not_authorized',
            'This WordPress site is not connected to an active KOBA-I workspace.',
            403
        );
    }

    $licensed_origin = koba_normalize_gateway_site_origin(
        get_option( 'koba_license_associated_website' )
    );
    $current_origin = koba_normalize_gateway_site_origin( home_url( '/' ) );
    if ( ! $licensed_origin || ! $current_origin || $licensed_origin !== $current_origin ) {
        return koba_gateway_permission_error(
            'koba_gateway_site_origin_mismatch',
            'The KOBA-I workspace is registered to another WordPress origin.',
            403
        );
    }

    $params = $request->get_json_params();
    $params = is_array( $params ) ? $params : array();
    // Match the write handler's legacy default exactly. Omitting status must
    // never let an edit-only account create a published record.
    $status = sanitize_key( $params['status'] ?? 'published' );
    $required_capabilities = $status === 'published'
        ? array( 'publish_posts', 'publish_pages' )
        : array( 'edit_posts', 'edit_pages' );
    foreach ( $required_capabilities as $capability ) {
        if ( ! current_user_can( $capability ) ) {
            return koba_gateway_permission_error(
                'koba_gateway_capability_required',
                'The authenticated gateway user may not modify publications on this site.',
                403
            );
        }
    }

    foreach ( array( 'expectedPublicationId', 'expectedPageId' ) as $field ) {
        $expected_id = absint( $params[ $field ] ?? 0 );
        if ( $expected_id > 0 && ! current_user_can( 'edit_post', $expected_id ) ) {
            return koba_gateway_permission_error(
                'koba_gateway_publication_forbidden',
                'The authenticated gateway user may not modify the requested publication.',
                403
            );
        }
    }

    return true;
}

function koba_find_publication_post_by_asset_key( $asset_key, $post_type ) {
    $query = new WP_Query(
        array(
            'post_type'      => $post_type,
            'post_status'    => 'any',
            'posts_per_page' => 1,
            'fields'         => 'ids',
            'meta_query'     => array(
                'relation' => 'OR',
                array( 'key' => 'koba_asset_key', 'value' => $asset_key ),
                array( 'key' => 'assetKey', 'value' => $asset_key ),
                array( 'key' => '_koba_asset_key', 'value' => $asset_key ),
            ),
        )
    );

    return ! empty( $query->posts ) ? (int) $query->posts[0] : 0;
}

function koba_resolve_existing_publication_post( $expected_id, $asset_key, $post_type, $slug ) {
    if ( $expected_id > 0 ) {
        $expected_post = get_post( $expected_id );
        if ( ! $expected_post || $expected_post->post_type !== $post_type ) {
            return koba_gateway_permission_error(
                'publication_identity_conflict',
                'The saved WordPress publication identity no longer resolves to the expected record.',
                409
            );
        }
        $expected_asset_key = get_post_meta( $expected_id, 'koba_asset_key', true );
        if ( ! $expected_asset_key ) {
            $expected_asset_key = get_post_meta( $expected_id, 'assetKey', true );
        }
        if ( $expected_asset_key && $expected_asset_key !== $asset_key ) {
            return koba_gateway_permission_error(
                'publication_identity_conflict',
                'The saved WordPress record belongs to a different publication.',
                409
            );
        }
        return $expected_id;
    }

    $asset_post_id = koba_find_publication_post_by_asset_key( $asset_key, $post_type );
    if ( $asset_post_id > 0 ) {
        return $asset_post_id;
    }

    $slug_post = get_page_by_path( $slug, OBJECT, $post_type );
    if ( ! $slug_post ) {
        return 0;
    }
    $slug_asset_key = get_post_meta( $slug_post->ID, 'koba_asset_key', true );
    if ( ! $slug_asset_key ) {
        $slug_asset_key = get_post_meta( $slug_post->ID, 'assetKey', true );
    }
    if ( $slug_asset_key && $slug_asset_key !== $asset_key ) {
        return koba_gateway_permission_error(
            'publication_identity_conflict',
            'The requested WordPress slug belongs to a different publication.',
            409
        );
    }
    return (int) $slug_post->ID;
}
