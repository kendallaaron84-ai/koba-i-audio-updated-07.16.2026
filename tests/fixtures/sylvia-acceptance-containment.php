<?php
/** Temporary acceptance window. All customer publication writes remain contained. */
if ( ! defined( 'ABSPATH' ) ) exit;
add_filter( 'rest_pre_dispatch', function ( $result, $server, $request ) {
    unset( $server );
    if ( strtoupper( $request->get_method() ) !== 'POST' || ! in_array( $request->get_route(), array( '/kobai/v1/publish-vault', '/kobai/v1/update-chapter-audio' ), true ) ) return $result;
    $params = $request->get_json_params();
    if ( rtrim( home_url( '/' ), '/' ) === 'https://shop.drsylvialove.com' && is_array( $params ) &&
         in_array( $params['assetKey'] ?? '', array( 'ebk_p1_restore_sylvia_20261103', 'abk_p1_restore_sylvia_20261104' ), true ) ) {
        $private = in_array( $params['status'] ?? '', array( 'draft', 'ready' ), true );
        $protected_public_test = ( $params['status'] ?? '' ) === 'published' && is_numeric( $params['price'] ?? null ) && (float) $params['price'] === 99.0;
        // This exception is not authorization: the existing authentication,
        // tenant, origin, capability, identity and mutex checks still run.
        if ( $private || $protected_public_test ) return $result;
    }
    return new WP_Error( 'koba_emergency_write_containment', 'KOBA-I publication synchronization is temporarily unavailable.', array( 'status' => 503 ) );
}, -1000, 3 );
