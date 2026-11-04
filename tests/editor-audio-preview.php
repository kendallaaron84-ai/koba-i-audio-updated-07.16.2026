<?php
// Reuse the existing WordPress authorization fixture; no production connection.
require __DIR__ . '/gateway-security.php';
function add_filter() {}
function is_wp_error( $value ) { return $value instanceof WP_Error; }
function is_user_logged_in() { return $GLOBALS['test_user_id'] > 0; }
function wp_kses_post( $value ) { return (string) $value; }
function wp_create_nonce() { return 'offline-editor-nonce'; }
function rest_url( $path ) { return 'https://author.example/wp-json/' . $path; }
function add_query_arg( $key, $value, $url ) { return $url . '?' . $key . '=' . $value; }
function is_preview() { return true; }
function get_the_title() { return 'Synthetic private audio'; }
require __DIR__ . '/../includes/editor-preview.php';

$GLOBALS['test_options'] = array( 'koba_license_status' => 'active', 'koba_license_key' => 'KOBA-AUDIO-12345678', 'koba_license_associated_website' => 'https://author.example' );
$GLOBALS['test_home_url'] = 'https://author.example';
$GLOBALS['test_user_id'] = 4;
$GLOBALS['test_capabilities'] = array( 'edit_post:28' => true );
$asset = 'abk_private_editor_fixture';
$path = 'studio/' . $asset . '/KOBA-AUDIO-12345678/source/chapter.wav';
$params = array( 'type' => 'audiobook', 'status' => 'draft', 'assetKey' => $asset, 'studioKey' => 'KOBA-AUDIO-12345678', 'targetWpOrigin' => 'https://author.example',
    'chapters' => array( array( 'id' => 'first', 'title' => 'First chapter', 'storagePath' => $path, 'duration' => 4 ), array( 'id' => 'last', 'title' => 'Last chapter', 'storagePath' => $path, 'duration' => 4 ) ),
    'ebookPayload' => array( 'privatePreviewGrant' => 'offline-only-audio-grant' ) );
$snapshot = koba_prepare_editor_preview_snapshot( $params );
if ( is_wp_error( $snapshot ) || count( $snapshot['chapters'] ) !== 2 || count( $snapshot['audio'] ) !== 1 ) throw new RuntimeException( 'Private audio snapshot lost its chapters.' );
$GLOBALS['test_posts'][28] = (object) array( 'ID' => 28, 'post_type' => 'koba_publication', 'post_status' => 'draft' );
$GLOBALS['test_meta'][28] = array( '_koba_media_type' => 'audiobook', 'assetKey' => $asset, 'koba_asset_key' => $asset, '_koba_editor_preview' => $snapshot );
if ( is_wp_error( koba_authorize_editor_preview( 28 ) ) ) throw new RuntimeException( 'Authorized editor rejected.' );
$book = koba_editor_preview_book( 28, $asset );
if ( count( $book['chapters'] ) !== 2 || strpos( $book['chapters'][1]['url'], '/editor-preview/28/audio/' ) === false || strpos( json_encode( $book ), 'offline-only-audio-grant' ) !== false || strpos( json_encode( $book ), $path ) !== false ) throw new RuntimeException( 'Private audio projection or grant boundary failed.' );
foreach ( array( 'anonymous', 'subscriber', 'other post', 'other asset', 'other installation', 'published' ) as $case ) {
    $GLOBALS['test_user_id'] = 4;
    $GLOBALS['test_capabilities'] = array( 'edit_post:28' => true );
    $GLOBALS['test_posts'][28]->post_status = 'draft';
    $GLOBALS['test_meta'][28]['assetKey'] = $asset;
    $GLOBALS['test_options']['koba_license_key'] = 'KOBA-AUDIO-12345678';
    $post_id = 28;
    if ( $case === 'anonymous' ) $GLOBALS['test_user_id'] = 0;
    if ( $case === 'subscriber' ) $GLOBALS['test_capabilities'] = array();
    if ( $case === 'other post' ) $post_id = 29;
    if ( $case === 'other asset' ) $GLOBALS['test_meta'][28]['assetKey'] = 'abk_other';
    if ( $case === 'other installation' ) $GLOBALS['test_options']['koba_license_key'] = 'KOBA-AUDIO-AAAAAAAA';
    if ( $case === 'published' ) $GLOBALS['test_posts'][28]->post_status = 'publish';
    if ( ! is_wp_error( koba_authorize_editor_preview( $post_id ) ) ) throw new RuntimeException( 'Accepted unauthorized audio case: ' . $case );
}
$GLOBALS['test_options']['koba_license_key'] = 'KOBA-AUDIO-12345678';
$bad = $params; $bad['chapters'][0]['storagePath'] = 'studio/abk_other/KOBA-AUDIO-12345678/source/foreign.wav';
assert_error( koba_prepare_editor_preview_snapshot( $bad ), 'koba_preview_audio_invalid', 400 );
$empty = $params; $empty['chapters'] = array( array( 'title' => 'Unuploaded draft' ) );
if ( koba_prepare_editor_preview_snapshot( $empty )['chapters'] !== array() ) throw new RuntimeException( 'Empty draft could not stage safely.' );
foreach ( array( array( '', 100, array(0,99) ), array( null,100,array(0,99) ), array( 'bytes=0-1',100,array(0,1) ), array( 'Bytes=0-1',100,array(0,1) ), array( 'bytes=90-',100,array(90,99) ), array( 'bytes=-5',100,array(95,99) ), array( 'bytes=0-',10000000,array(0,4194303) ) ) as $case ) {
    if ( koba_editor_preview_audio_range( $case[0], $case[1] ) !== $case[2] ) throw new RuntimeException( 'Incorrect bounded audio range.' );
}
foreach ( array( 'bytes=100-', 'bytes=9-2', 'bytes=0-1,4-5', 'bytes=-0', 'bytes=-', 'garbage' ) as $value ) assert_error( koba_editor_preview_audio_range( $value, 100 ), 'koba_preview_audio_range', 416 );
echo "Private audio passed: exact editor/asset/site binding, anonymous/subscriber/foreign/published rejection, no grant or storage-path disclosure, empty drafts, seek/suffix/bounded/invalid byte ranges.\n";
