<?php
if ( ! defined( 'ABSPATH' ) ) exit;

/**
 * 1. LEGACY VAULT UI
 * (Kept for backward compatibility, though Hub now handles keys)
 */
function koba_render_security_vault() {
    if (isset($_POST['koba_save_security'])) {
        update_option('koba_google_json_path', stripslashes(sanitize_text_field($_POST['google_path'])));
        update_option('koba_google_bucket', sanitize_text_field($_POST['google_bucket']));
        echo '<div class="updated"><p>Vault Locked.</p></div>';
    }
    ?>
    <div class="wrap" style="background:#020617; color:white; padding:40px; border-radius:12px;">
        <h1 style="color:#f97316;">Security Vault</h1>
        <p style="opacity:0.7;">Note: Version 3.7.1+ uses the Secure Hub. These fields are legacy.</p>
        <form method="post">
            <p>JSON Path: <input type="text" name="google_path" value="<?php echo esc_attr(get_option('koba_google_json_path')); ?>" style="width:100%;"></p>
            <p>Bucket Name: <input type="text" name="google_bucket" value="<?php echo esc_attr(get_option('koba_google_bucket')); ?>" style="width:100%;"></p>
            <input type="submit" name="koba_save_security" class="button button-primary" value="SAVE VAULT">
        </form>
    </div>
    <?php
}

/**
 * 2. THE KOBA LOCK SHORTCODE
 * Protects pages so only book owners can see them.
 * USAGE: [koba_lock download_id="123"] ... [/koba_lock]
 */
add_shortcode('koba_lock', function($atts, $content = null) {
    // 1. Get the required Product ID (Download ID)
    $args = shortcode_atts(['download_id' => 0], $atts);
    $download_id = intval($args['download_id']);

    // 2. Check if they bought the book
    $user_id = get_current_user_id();
    $has_access = false;
    $price = '14.99'; // Default fallback
    
    if (function_exists('edd_has_user_purchased')) {
        $has_access = edd_has_user_purchased($user_id, $download_id);
        if (function_exists('edd_get_download_price')) {
            $price = edd_get_download_price($download_id);
        }
    }

    // 3. Return Content OR "Buy Now" Message
    if ($has_access) {
        return do_shortcode($content); // Show the Player!
    } else {
        $buy_link = '/checkout?edd_action=add_to_cart&download_id=' . $download_id;
        
        // Bulletproof Inline HTML/CSS with Premium Padlock SVG
        return '<div style="display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 50px 20px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; margin: 30px auto; max-width: 500px; box-shadow: 0 4px 15px rgba(0,0,0,0.05); font-family: sans-serif;">
            
            <svg viewBox="0 0 24 24" style="width: 70px; height: 70px; margin-bottom: 20px; fill: #475569; display: block;">
                <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM9 6c0-1.66 1.34-3 3-3s3 1.34 3 3v2H9V6zm9 14H6V10h12v10zm-6-3c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z"/>
            </svg>
            
            <h3 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 600; color: #1e293b;">Premium Vault</h3>
            <p style="margin: 0 0 25px 0; font-size: 16px; color: #64748b;">You do not own this audiobook yet.</p>
            
            <a href="' . esc_url($buy_link) . '" style="display: inline-block; padding: 14px 32px; background-color: #f97316; color: #ffffff; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px rgba(249, 115, 22, 0.25);">Unlock Now for $' . esc_html($price) . '</a>
        </div>';
    }
});