<?php
/**
 * KOBA-I Audio: EDD Bridge
 * Connects the Studio to Easy Digital Downloads for seamless checkout.
 */

if (!defined('ABSPATH')) exit;

class Koba_EDD_Bridge {

    // CHANGE THIS: The ID of your generic "Transcription Service" product in EDD
    private $service_product_id = 336081; 

    public function __construct() {
        // 1. Hook into EDD Payment Completion
        add_action('edd_complete_purchase', [$this, 'handle_purchase_completion']);
        
        // 2. Handle "Add to Cart" via AJAX (from your Studio)
        add_action('wp_ajax_koba_add_to_cart', [$this, 'ajax_add_to_cart']);
    }

    /**
     * AJAX: Adds the Transcription Credits to the Cart
     */
    public function ajax_add_to_cart() {
        check_ajax_referer('k_studio_nonce', 'nonce');

        $book_id = intval($_POST['post_id']);
        $hours   = intval($_POST['hours']);

        if (!$this->service_product_id) {
            wp_send_json_error("Service Product ID not configured in Code.");
        }

        $cart_item_data = [
            'koba_book_id' => $book_id
        ];

        $added = edd_add_to_cart($this->service_product_id, [
            'quantity' => $hours,
            'item_price' => 0.50, 
            'options' => $cart_item_data
        ]);

        if ($added) {
            wp_send_json_success(['redirect' => edd_get_checkout_uri()]);
        } else {
            wp_send_json_error("Could not add to cart.");
        }
    }

    /**
     * THE TRIGGER: Runs when money successfully hits your bank.
     */
    public function handle_purchase_completion($payment_id) {
        $cart_items = edd_get_payment_meta_cart_details($payment_id);

        foreach ($cart_items as $item) {
            if (isset($item['item_number']['options']['koba_book_id'])) {
                $book_id = intval($item['item_number']['options']['koba_book_id']);

                update_post_meta($book_id, '_koba_payment_status', 'paid');
                update_post_meta($book_id, '_koba_payment_id', $payment_id);

                $this->trigger_auto_transcription($book_id);
            }
        }
    }

    private function trigger_auto_transcription($book_id) {
        // For now, it marks it as PAID.
        $processor = new Koba_AI_Processor();
        // You would need to add a method to processor to "Start All Chapters"
    }
}

// Initialize the original cart logic
new Koba_EDD_Bridge();

/* -------------------------------------------------------------------------
 * NEW BRIDGE UI: Linking EDD Products to Audiobooks
 * ------------------------------------------------------------------------- */

// 1. Add the Meta Box to the EDD Product Screen
add_action('add_meta_boxes', function() {
    add_meta_box(
        'koba_edd_bridge', 
        'KOBA-I Studio Link', 
        'koba_render_edd_bridge_box', 
        'download', // Targets the EDD post type
        'side', 
        'high'
    );
});

// 2. Render the Dropdown Interface
function koba_render_edd_bridge_box($post) {
    $linked_audiobook = get_post_meta($post->ID, '_koba_linked_audiobook', true);
    $audiobooks = get_posts(['post_type' => 'koba_publication', 'posts_per_page' => -1]);

    echo '<label for="koba_linked_audiobook" style="display:block; margin-bottom:8px;"><strong>Select the Audiobook this product unlocks:</strong></label>';
    echo '<select name="koba_linked_audiobook" id="koba_linked_audiobook" style="width:100%;">';
    echo '<option value="">-- Select an Audiobook --</option>';
    
    foreach($audiobooks as $ab) {
        $selected = ($linked_audiobook == $ab->ID) ? 'selected' : '';
        echo '<option value="'. esc_attr($ab->ID) .'" '.$selected.'>'. esc_html($ab->post_title) .'</option>';
    }
    echo '</select>';
    
    wp_nonce_field('koba_bridge_nonce_save', 'koba_bridge_nonce');
}

// 3. Save the Link when the EDD Product is updated
add_action('save_post', function($post_id) {
    if (!isset($_POST['koba_bridge_nonce']) || !wp_verify_nonce($_POST['koba_bridge_nonce'], 'koba_bridge_nonce_save')) return;
    if (defined('DOING_AUTOSAVE') && DOING_AUTOSAVE) return;
    
    if (isset($_POST['koba_linked_audiobook'])) {
        update_post_meta($post_id, '_koba_linked_audiobook', sanitize_text_field($_POST['koba_linked_audiobook']));
    }
});