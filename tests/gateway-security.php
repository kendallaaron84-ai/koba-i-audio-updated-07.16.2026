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
    public function __construct( $params ) { $this->params = $params; }
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

echo "Gateway security negative tests passed.\n";
