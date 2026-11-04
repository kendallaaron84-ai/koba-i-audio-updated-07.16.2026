<?php
define( 'ABSPATH', __DIR__ );
class WP_Error { public $code; public function __construct( $code, $message, $data ) { $this->code = $code; } }
function add_filter( $name, $callback, $priority, $arguments ) { if ( $name !== 'rest_pre_dispatch' || $priority !== -1000 || $arguments !== 3 ) throw new RuntimeException( 'Unexpected guard priority.' ); $GLOBALS['guard'] = $callback; }
function home_url() { return $GLOBALS['origin']; }
class AcceptanceRequest {
    private $body; public function __construct( $body ) { $this->body = $body; }
    public function get_method() { return 'POST'; }
    public function get_route() { return '/kobai/v1/publish-vault'; }
    public function get_json_params() { return $this->body; }
}
require __DIR__ . '/fixtures/sylvia-acceptance-containment.php';
$GLOBALS['origin'] = 'https://shop.drsylvialove.com';
foreach ( array( 'ebk_p1_restore_sylvia_20261103', 'abk_p1_restore_sylvia_20261104' ) as $asset ) {
    foreach ( array( 'draft', 'ready', 'published' ) as $status ) {
        $result = $GLOBALS['guard']( 'next-security-handler', null, new AcceptanceRequest( array( 'assetKey' => $asset, 'status' => $status, 'price' => 99 ) ) );
        if ( $result !== 'next-security-handler' ) throw new RuntimeException( 'Named acceptance test blocked.' );
    }
    foreach ( array( 0, -1, 1, 'NaN', null ) as $price ) {
        $result = $GLOBALS['guard']( null, null, new AcceptanceRequest( array( 'assetKey' => $asset, 'status' => 'published', 'price' => $price ) ) );
        if ( ! $result instanceof WP_Error || $result->code !== 'koba_emergency_write_containment' ) throw new RuntimeException( 'Non-approved publication price escaped containment.' );
    }
}
foreach ( array( array(), array( 'assetKey' => 'customer-book', 'status' => 'draft' ), array( 'assetKey' => 'ebk_108fb8866cb54594802f371895fc415b', 'status' => 'published', 'price' => 99 ) ) as $body ) {
    if ( ! $GLOBALS['guard']( null, null, new AcceptanceRequest( $body ) ) instanceof WP_Error ) throw new RuntimeException( 'Customer publication escaped containment.' );
}
$GLOBALS['origin'] = 'https://audio.koba-i.com';
if ( ! $GLOBALS['guard']( null, null, new AcceptanceRequest( array( 'assetKey' => 'ebk_p1_restore_sylvia_20261103', 'status' => 'draft' ) ) ) instanceof WP_Error ) throw new RuntimeException( 'Site boundary failed.' );
echo "Acceptance containment passed: only the two named Sylvia fixtures; private staging or exact protected test price; all customer/site mismatches blocked; core authorization remains mandatory.\n";
