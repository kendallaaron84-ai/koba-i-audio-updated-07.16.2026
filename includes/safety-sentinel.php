<?php
/**
 * KOBA-I Audio: Safety Sentinel
 * * v5.2.0 - Updated for SaaS Model (No Local Keys Required)
 */

if (!defined('ABSPATH')) exit;

class Koba_Safety_Sentinel {

    public static function scan() {
        $issues = [];

        // 1. Check for Composer Vendor Folder
        if (!file_exists(KOBA_IA_PATH . 'vendor/autoload.php')) {
            $issues[] = "<strong>Vendor Missing:</strong> Run 'composer install' in the plugin directory.";
        }

        // --- REMOVED: Google Key Check ---
        // The Hub (v1.php) handles the keys now. 

        if (!empty($issues)) {
            add_action('admin_notices', function() use ($issues) {
                echo '<div class="notice notice-error is-dismissible"><h3>KOBA-I Sentinel Alert</h3><ul>';
                foreach ($issues as $issue) {
                    echo "<li>$issue</li>";
                }
                echo '</ul></div>';
            });
            return false;
        }

        return true;
    }
}