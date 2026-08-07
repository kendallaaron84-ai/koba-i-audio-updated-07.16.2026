<?php

if (!defined('ABSPATH')) {
    exit;
}

/**
 * Usage:
 * [koba_reader asset="ebk_sample-ebook"]
 */
add_shortcode('koba_reader', 'koba_render_reader_shortcode');

function koba_render_reader_shortcode($atts) {
    $atts = shortcode_atts(
        array(
            'asset' => '',
        ),
        $atts,
        'koba_reader'
    );

    $asset_key = sanitize_text_field($atts['asset']);

    if ($asset_key === '') {
        return '
            <div style="
                color:#ef4444;
                padding:20px;
                background:rgba(239,68,68,0.1);
                border-radius:6px;
                font-family:system-ui,sans-serif;
                text-align:center;
            ">
                ⚠️ <strong>Reader Error:</strong>
                No publication asset key was specified.
            </div>
        ';
    }

    if (
        !function_exists(
            'koba_render_sovereign_player_engine_by_asset'
        )
    ) {
        return '
            <div style="
                color:#ef4444;
                padding:20px;
                text-align:center;
                font-family:system-ui,sans-serif;
            ">
                Platform Configuration Error:
                Core media dispatcher is unavailable.
            </div>
        ';
    }

    ob_start();

    koba_render_sovereign_player_engine_by_asset(
        $asset_key
    );

    return ob_get_clean();
}