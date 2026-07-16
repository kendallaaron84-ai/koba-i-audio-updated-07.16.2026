<?php
/**
 * KOBA-I Audio: Remote AI Engine
 * * v5.3.0 - Connected to Secure Hub + Content Moderation
 */
if (!defined('ABSPATH')) exit;

class Koba_AI_Engine {

    // --- CONNECTION SETTINGS ---
    private $hub_url = 'https://audio.koba-i.com/api/v1.php'; 
    private $api_key = 'Koba_Secure_012767'; 

    public function start_chirp_job($file_url) {
        $body = ['action' => 'start_job', 'api_key' => $this->api_key, 'file_url' => $file_url];
        $data = $this->send_to_hub($body, 45);
        return $data['op_name'];
    }

    public function check_job_status($op_name) {
        $body = ['action' => 'check_status', 'api_key' => $this->api_key, 'op_name' => $op_name];
        
        // This now returns ['status' => 'completed', 'result_uri' => 'gs://...']
        return $this->send_to_hub($body, 15);
    }

    public function fetch_transcript_json($gcs_uri) {
        // Send the GCS URI to the Hub. 
        // The Hub will download it, check OpenAI, and return the data if safe.
        $body = [
            'action' => 'fetch_transcript',
            'api_key' => $this->api_key,
            'result_uri' => $gcs_uri
        ];
        
        $data = $this->send_to_hub($body, 30);
        return $data['transcript']; // The actual JSON content
    }

    public function upload_to_vault($attachment_id) {
        return wp_get_attachment_url($attachment_id);
    }

    // --- HELPER TO REDUCE CODE REPETITION ---
    private function send_to_hub($body, $timeout) {
        $response = wp_remote_post($this->hub_url, [
            'body'    => $body,
            'timeout' => $timeout
        ]);

        if (is_wp_error($response)) {
            throw new Exception('Hub Connection Failed: ' . $response->get_error_message());
        }

        $code = wp_remote_retrieve_response_code($response);
        $data = json_decode(wp_remote_retrieve_body($response), true);

        if ($code !== 200 || !$data || empty($data['success'])) {
            $error = $data['data'] ?? 'Unknown Hub Error (' . $code . ')';
            throw new Exception($error);
        }

        return $data['data'];
    }
}