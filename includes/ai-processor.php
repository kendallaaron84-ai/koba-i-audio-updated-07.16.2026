<?php
/**
 * KOBA-I Audio: AI Processor & Cost Estimator
 * v5.1.0 - Adds Whole Book Estimation & Vault Logic
 */
if (!defined('ABSPATH')) exit;

class Koba_AI_Processor {

    private $vault_dir;
    private $vault_url;
    // PRICING SETTINGS
    const PRICE_PER_HOUR = 0.20; // Set this to your desired rate (e.g., $0.20 per hour)

    public function __construct() {
        // 1. Define the Safe Vault Location
        $upload_dir = wp_upload_dir();
        $this->vault_dir = trailingslashit($upload_dir['basedir']) . 'koba-vault/';
        $this->vault_url = trailingslashit($upload_dir['baseurl']) . 'koba-vault/';

        // 2. Register AJAX Endpoints
        add_action('wp_ajax_koba_transcribe_chapter', [$this, 'handle_transcribe']);
        add_action('wp_ajax_koba_check_chapter', [$this, 'handle_check']);
        
        // NEW: The Estimator Endpoint
        add_action('wp_ajax_koba_estimate_book', [$this, 'handle_estimate_book']);
    }

    /**
     * NEW: Calculates the total duration and cost for the entire book.
     */
    public function handle_estimate_book() {
        check_ajax_referer('k_studio_nonce', 'nonce');
        
        $post_id = intval($_POST['post_id']);
        $chapters_json = get_post_meta($post_id, '_koba_chapters_data', true);
        
        if (empty($chapters_json)) {
            wp_send_json_error('No chapters found.');
        }

        $chapters = koba_get_chapters_from_json($chapters_json);
        $total_seconds = 0;
        $chapter_count = 0;

        // Loop through every chapter to sum up duration
        foreach ($chapters as $chapter) {
            if (!empty($chapter['attachment_id'])) {
                // Get audio metadata from WordPress
                $meta = wp_get_attachment_metadata($chapter['attachment_id']);
                
                // 'length' is usually stored in seconds by WordPress
                if (isset($meta['length'])) {
                    $total_seconds += (int) $meta['length'];
                    $chapter_count++;
                }
            }
        }

        if ($total_seconds === 0) {
            wp_send_json_error('Could not calculate duration. Are audio files uploaded to Media Library?');
        }

        // --- THE MATH ---
        $total_hours = $total_seconds / 3600;
        $estimated_cost = $total_hours * self::PRICE_PER_HOUR;
        
        // Minimum charge (optional, e.g., $1.00 minimum)
        if ($estimated_cost < 0.50) $estimated_cost = 0.50;

        // Format the time (e.g., "5h 30m")
        $hours = floor($total_seconds / 3600);
        $minutes = floor(($total_seconds / 60) % 60);
        $time_string = sprintf("%dh %02dm", $hours, $minutes);

        wp_send_json_success([
            'chapter_count' => $chapter_count,
            'duration_formatted' => $time_string,
            'total_seconds' => $total_seconds,
            'estimated_cost' => number_format($estimated_cost, 2), // Returns string like "5.68"
            'currency_symbol' => '$'
        ]);
    }

    public function handle_transcribe() {
        check_ajax_referer('k_studio_nonce', 'nonce');
        
        $post_id = intval($_POST['post_id']);
        $chapter_index = intval($_POST['chapter_index']);
        
        $chapters = koba_get_chapters_from_json(get_post_meta($post_id, '_koba_chapters_data', true));
        if (!isset($chapters[$chapter_index])) wp_send_json_error('Save required.');

        $chapter = $chapters[$chapter_index];
        $attachment_id = $chapter['attachment_id'] ?? 0;

        if (!$attachment_id) wp_send_json_error('No Audio File attached.');

        try {
            // SECURITY WARNING: This line fails if credentials are missing. 
            // For SaaS, this needs to call your Remote API, not local Google Engine.
            $engine = new Koba_AI_Engine(); 
            $gcs_uri = $engine->upload_to_vault($attachment_id);
            $op_name = $engine->start_chirp_job($gcs_uri);

            $chapters[$chapter_index]['ai_status'] = 'processing';
            $chapters[$chapter_index]['ai_op_name'] = $op_name;
            
            update_post_meta($post_id, '_koba_chapters_data', json_encode($chapters));
            wp_send_json_success(['status' => 'processing']);

        } catch (Throwable $e) { 
            wp_send_json_error('Error: ' . $e->getMessage());
        }
    }

    public function handle_check() {
        check_ajax_referer('k_studio_nonce', 'nonce');
        
        $post_id = intval($_POST['post_id']);
        $chapter_index = intval($_POST['chapter_index']);

        $chapters = koba_get_chapters_from_json(get_post_meta($post_id, '_koba_chapters_data', true));
        $chapter = $chapters[$chapter_index];

        if (($chapter['ai_status'] ?? '') !== 'processing') {
            wp_send_json_error('No active job.');
        }

        try {
            $engine = new Koba_AI_Engine();
            $status_data = $engine->check_job_status($chapter['ai_op_name']);

            if ($status_data['status'] === 'completed') {
                
                $result_uri = $status_data['result_uri'];
                $full_json_data = null;

                if ($result_uri) {
                    $full_json_data = $engine->fetch_transcript_json($result_uri);
                }

                if ($full_json_data) {
                    // Create Vault if missing
                    if (!file_exists($this->vault_dir)) {
                        mkdir($this->vault_dir, 0755, true);
                        file_put_contents($this->vault_dir . 'index.php', '<?php // Silence');
                    }

                    // Save File
                    $filename = 'transcript_' . $chapter['id'] . '.json';
                    $save_path = $this->vault_dir . $filename;
                    
                    // SMART SAVE: Prevent double-encoding if the Hub returned a string
                    $json_string = is_string($full_json_data) ? $full_json_data : json_encode($full_json_data);
                    
                    file_put_contents($save_path, $json_string);

                    $chapters[$chapter_index]['ai_status'] = 'completed';
                    $chapters[$chapter_index]['transcript_file_url'] = $this->vault_url . $filename;
                    unset($chapters[$chapter_index]['transcript_json']); 
                    
                    update_post_meta($post_id, '_koba_chapters_data', json_encode($chapters));
                    
                    wp_send_json_success([
                        'status' => 'completed', 
                        'message' => 'Saved: ' . $filename
                    ]);
                } else {
                    wp_send_json_error('Job complete, but result file missing.');
                }
            } else {
                wp_send_json_success(['status' => 'processing']);
            }

        } catch (Throwable $e) { 
            wp_send_json_error('Polling Error: ' . $e->getMessage());
        }
    }
}
new Koba_AI_Processor();