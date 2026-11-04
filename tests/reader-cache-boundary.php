<?php
// Execute the actual reader cache classifier without booting a WordPress server.
$source = file_get_contents( __DIR__ . '/../koba-i-audio.php' );
if ( ! preg_match( '/function koba_prevent_shared_reader_cache\(\) \{.*?^\}/ms', $source, $match ) ) throw new RuntimeException( 'Reader cache boundary missing.' );
eval( $match[0] );
function is_singular( $types ) { return in_array( $GLOBALS['post_type'], (array) $types, true ); }
function get_queried_object_id() { return 28; }
function is_page( $slug ) { return $GLOBALS['page_slug'] === $slug; }
function get_post_meta( $id, $key, $single ) { return $GLOBALS['meta'][ $key ] ?? ''; }
function nocache_headers() { $GLOBALS['nocache_calls']++; }
$cases = array(
    array( 'CPT reader', 'koba_publication', '', array(), array(), 1 ),
    array( 'book page', 'page', 'book', array( 'assetKey' => 'ebk_fixture' ), array(), 1 ),
    array( 'legacy book page', 'page', 'book', array( 'koba_asset_key' => 'abk_fixture' ), array(), 1 ),
    array( 'explicit shelf reader', 'page', 'bookshelf', array(), array( 'asset' => 'ebk_fixture' ), 1 ),
    array( 'empty bookshelf', 'page', 'bookshelf', array(), array(), 0 ),
    array( 'landing page', 'page', 'ink-and-oil', array(), array(), 0 ),
    array( 'ordinary page query', 'page', 'other', array(), array( 'asset' => 'ebk_fixture' ), 0 ),
    array( 'non singular request', '', '', array(), array(), 0 ),
    array( 'array query', 'page', 'bookshelf', array(), array( 'asset' => array( 'bad' ) ), 0 ),
);
foreach ( $cases as list( $name, $type, $slug, $meta, $query, $calls ) ) {
    $GLOBALS['post_type'] = $type; $GLOBALS['page_slug'] = $slug; $GLOBALS['meta'] = $meta; $_GET = $query; $GLOBALS['nocache_calls'] = 0;
    koba_prevent_shared_reader_cache();
    if ( $GLOBALS['nocache_calls'] !== $calls ) throw new RuntimeException( 'Reader cache classification failed: ' . $name );
}
if ( strpos( $match[0], "header( 'Cache-Control: private, no-store, max-age=0' )" ) === false ) throw new RuntimeException( 'Shared-cache protection missing.' );
echo "PASS: reader shells cannot enter shared caches; catalog and landing presentation untouched.\n";
