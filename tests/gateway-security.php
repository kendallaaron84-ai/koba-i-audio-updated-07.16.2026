<?php

define( 'ABSPATH', __DIR__ );
define( 'OBJECT', 'OBJECT' );

class WP_Error {
    private $code;
    private $data;
    public function __construct( $code, $message, $data ) {
        unset( $message );
        $this->code = $code;
        $this->data = $data;
    }
    public function get_error_code() { return $this->code; }
    public function get_error_data() { return $this->data; }
}

class WP_Query {
    public $posts = array();
    public function __construct( $args ) {
        unset( $args );
        $this->posts = $GLOBALS['test_query_posts'];
    }
}

class Test_Request {
    private $params;
    public function __construct( $params, $with_destination = true ) {
        $this->params = $with_destination ? array_merge( array(
            'studioKey' => 'KOBA-AUDIO-12345678',
            'targetWpOrigin' => 'https://author.example',
        ), $params ) : $params;
    }
    public function get_json_params() { return $this->params; }
}

function add_action() {}
function wp_get_current_user() { return (object) array( 'ID' => $GLOBALS['test_user_id'] ); }
function get_option( $name ) { return $GLOBALS['test_options'][ $name ] ?? ''; }
function home_url() { return $GLOBALS['test_home_url']; }
function sanitize_key( $value ) { return strtolower( preg_replace( '/[^a-z0-9_-]/i', '', (string) $value ) ); }
function absint( $value ) { return abs( (int) $value ); }
function current_user_can( $capability, $object_id = null ) {
    $key = $object_id === null ? $capability : $capability . ':' . (int) $object_id;
    return ! empty( $GLOBALS['test_capabilities'][ $key ] );
}
function get_post( $id ) { return $GLOBALS['test_posts'][ $id ] ?? null; }
function get_post_meta( $id, $key ) { return $GLOBALS['test_meta'][ $id ][ $key ] ?? ''; }
function get_page_by_path() { return $GLOBALS['test_slug_post']; }
function sanitize_text_field( $value ) { return trim( (string) $value ); }
function wp_generate_uuid4() { return 'offline-lock-token'; }
class Test_WPDB {
    public $options = 'wp_options';
    public function prepare( $sql, ...$args ) { return array( $sql, $args ); }
    public function query( $query ) {
        list( $sql, $args ) = $query;
        list( $name, $value ) = $args;
        if ( strpos( $sql, 'INSERT IGNORE INTO wp_options' ) === 0 ) {
            if ( array_key_exists( $name, $GLOBALS['test_options'] ) ) return 0;
            $GLOBALS['test_options'][$name] = $value;
            return 1;
        }
        if ( strpos( $sql, 'DELETE FROM wp_options WHERE option_name = %s AND option_value = %s' ) === 0 ) {
            if ( ($GLOBALS['test_options'][$name] ?? null) !== $value ) return 0;
            unset( $GLOBALS['test_options'][$name] );
            return 1;
        }
        throw new RuntimeException( 'Unexpected lock SQL.' );
    }
}
$GLOBALS['wpdb'] = new Test_WPDB();
function delete_option( $name ) { unset( $GLOBALS['test_options'][$name] ); }
function koba_agent_create_vault_page( $request ) {
    ++$GLOBALS['test_write_calls'];
    return isset( $GLOBALS['test_write_callback'] )
        ? ($GLOBALS['test_write_callback'])( $request ) : 'written';
}

require_once __DIR__ . '/../includes/gateway-security.php';

function reset_state() {
    $GLOBALS['test_user_id'] = 0;
    $GLOBALS['koba_gateway_application_password_user_id'] = 0;
    $GLOBALS['test_options'] = array(
        'koba_license_status' => 'active',
        'koba_license_key' => 'KOBA-AUDIO-12345678',
        'koba_license_associated_website' => 'https://author.example',
    );
    $GLOBALS['test_home_url'] = 'https://author.example/';
    $GLOBALS['test_capabilities'] = array();
    $GLOBALS['test_query_posts'] = array();
    $GLOBALS['test_posts'] = array();
    $GLOBALS['test_meta'] = array();
    $GLOBALS['test_slug_post'] = null;
    $GLOBALS['test_write_calls'] = 0;
    unset( $GLOBALS['test_write_callback'] );
}

function assert_error( $actual, $code, $status ) {
    if ( ! $actual instanceof WP_Error || $actual->get_error_code() !== $code || $actual->get_error_data()['status'] !== $status ) {
        throw new RuntimeException( 'Expected ' . $code . ' with HTTP ' . $status );
    }
}

reset_state();
assert_error(
    koba_authorize_gateway_publication_write( new Test_Request( array() ) ),
    'koba_gateway_authentication_required',
    401
);

reset_state();
$GLOBALS['test_user_id'] = 7;
assert_error(
    koba_authorize_gateway_publication_write( new Test_Request( array() ) ),
    'koba_gateway_authentication_required',
    401
);

reset_state();
$GLOBALS['test_user_id'] = 7;
$GLOBALS['koba_gateway_application_password_user_id'] = 8;
assert_error(
    koba_authorize_gateway_publication_write( new Test_Request( array() ) ),
    'koba_gateway_authentication_required',
    401
);

reset_state();
$GLOBALS['test_user_id'] = 7;
$GLOBALS['koba_gateway_application_password_user_id'] = 7;
$GLOBALS['test_options']['koba_license_associated_website'] = 'https://another.example';
assert_error(
    koba_authorize_gateway_publication_write( new Test_Request( array() ) ),
    'koba_gateway_site_origin_mismatch',
    403
);

reset_state();
$GLOBALS['test_user_id'] = 7;
$GLOBALS['koba_gateway_application_password_user_id'] = 7;
assert_error(
    koba_authorize_gateway_publication_write( new Test_Request( array() ) ),
    'koba_gateway_capability_required',
    403
);

reset_state();
$GLOBALS['test_user_id'] = 7;
$GLOBALS['koba_gateway_application_password_user_id'] = 7;
$GLOBALS['test_capabilities'] = array( 'edit_posts' => true, 'edit_pages' => true );
if ( koba_authorize_gateway_publication_write( new Test_Request( array( 'status' => 'draft' ) ) ) !== true ) {
    throw new RuntimeException( 'Authorized draft gateway request was rejected.' );
}

reset_state();
$GLOBALS['test_user_id'] = 7;
$GLOBALS['koba_gateway_application_password_user_id'] = 7;
$GLOBALS['test_capabilities'] = array( 'edit_posts' => true, 'edit_pages' => true );
assert_error(
    koba_authorize_gateway_publication_write(
        new Test_Request( array( 'status' => 'draft', 'expectedPublicationId' => 31 ) )
    ),
    'koba_gateway_publication_forbidden',
    403
);

reset_state();
$GLOBALS['test_posts'][31] = (object) array( 'post_type' => 'koba_publication' );
$GLOBALS['test_meta'][31] = array( 'koba_asset_key' => 'abk_other_publication' );
assert_error(
    koba_resolve_existing_publication_post( 31, 'abk_requested_publication', 'koba_publication', 'requested' ),
    'publication_identity_conflict',
    409
);

// Exercise real author/site combinations without touching a production site.
$sites = array(
    array( 'KOBA-AUDIO-E63DC9CA', 'https://audio.koba-i.com' ),
    array( 'KOBA-AUDIO-E63DC9CA', 'https://duncan-hunter.koba-i.com' ),
    array( 'KOBA-AUDIO-8B0B3DF1D00569BA', 'https://shop.drsylvialove.com' ),
);
$matrix_cases = 0;
foreach ( $sites as $installation ) {
    foreach ( $sites as $incoming ) {
        reset_state();
        $GLOBALS['test_user_id'] = 7;
        $GLOBALS['koba_gateway_application_password_user_id'] = 7;
        $GLOBALS['test_options']['koba_license_key'] = $installation[0];
        $GLOBALS['test_options']['koba_license_associated_website'] = $installation[1];
        $GLOBALS['test_home_url'] = $installation[1];
        $GLOBALS['test_capabilities'] = array( 'edit_posts' => true, 'edit_pages' => true );
        $result = koba_authorize_gateway_publication_write( new Test_Request( array(
            'studioKey' => $incoming[0], 'targetWpOrigin' => $incoming[1], 'status' => 'draft',
        ), false ) );
        if ( $installation === $incoming ) {
            if ( $result !== true ) throw new RuntimeException( 'Valid tenant/site combination rejected.' );
        } else {
            assert_error( $result, $installation[0] !== $incoming[0]
                ? 'koba_gateway_studio_key_mismatch' : 'koba_gateway_destination_mismatch', 403 );
        }
        ++$matrix_cases;
    }
}
foreach ( array( array(), array( 'studioKey' => array() ), array( 'studioKey' => 'KOBA-AUDIO-12345678' ),
    array( 'studioKey' => 'KOBA-AUDIO-12345678', 'targetWpOrigin' => array() ) ) as $params ) {
    reset_state();
    $GLOBALS['test_user_id'] = $GLOBALS['koba_gateway_application_password_user_id'] = 7;
    $GLOBALS['test_capabilities'] = array( 'edit_posts' => true, 'edit_pages' => true );
    $result = koba_authorize_gateway_publication_write( new Test_Request( $params, false ) );
    assert_error( $result, empty( $params['studioKey'] ) || ! is_string( $params['studioKey'] )
        ? 'koba_gateway_studio_key_mismatch' : 'koba_gateway_destination_mismatch', 403 );
}
reset_state();
$GLOBALS['test_user_id'] = $GLOBALS['koba_gateway_application_password_user_id'] = 7;
$GLOBALS['test_capabilities'] = array( 'edit_posts' => true, 'edit_pages' => true );
foreach ( array( 'draft', 'ready' ) as $status ) {
    if ( koba_authorize_gateway_publication_write( new Test_Request( array( 'status' => $status ) ) ) !== true ) {
        throw new RuntimeException( 'Private staging status rejected.' );
    }
}
assert_error( koba_authorize_gateway_publication_write( new Test_Request( array( 'status' => 'published' ) ) ),
    'koba_gateway_capability_required', 403 );
assert_error( koba_authorize_gateway_publication_write( new Test_Request( array() ) ),
    'koba_gateway_capability_required', 403 );
reset_state();
$request=new Test_Request( array( 'assetKey'=>'ebk_lock_fixture' ) );
$lock='koba_publication_write_'.hash('sha256','ebk_lock_fixture');
$GLOBALS['test_options'][$lock]='another-writer';
assert_error(koba_gateway_write_publication($request),'koba_publication_busy',409);
if ($GLOBALS['test_write_calls']!==0 || get_option($lock)!=='another-writer') throw new RuntimeException('Held lock was bypassed or removed.');
delete_option($lock);
if (koba_gateway_write_publication($request)!=='written' || get_option($lock)!=='') throw new RuntimeException('Successful write lock was not released.');
$GLOBALS['test_write_callback']=function() { throw new RuntimeException('synthetic failure'); };
try { koba_gateway_write_publication($request); } catch (RuntimeException $e) {
    if ($e->getMessage()!=='synthetic failure') throw $e;
}
if (get_option($lock)!=='') throw new RuntimeException('Failed write lock was not released.');
$GLOBALS['test_write_callback']=function($nested) {
    assert_error(koba_gateway_write_publication($nested),'koba_publication_busy',409);
    return 'serialized';
};
if (koba_gateway_write_publication($request)!=='serialized') throw new RuntimeException('Nested concurrent write was not serialized.');
$GLOBALS['test_write_callback']=function() use ($lock) {
    $GLOBALS['test_options'][$lock]='replacement-owner';
    return 'changed';
};
if (koba_gateway_write_publication($request)!=='changed' || get_option($lock)!=='replacement-owner') throw new RuntimeException('Cleanup deleted a different lock owner.');
delete_option($lock);
assert_error(koba_gateway_write_publication(new Test_Request(array())),'missing_data',400);
echo "Gateway security passed: existing negative checks, 9 tenant/site combinations, 4 malformed/missing bindings, draft/ready and published capability gates.\n";
echo "Per-asset lock passed: held lock, cleanup on success/failure, overlapping retry, missing asset.\n";
