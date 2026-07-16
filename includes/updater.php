<?php
if ( ! defined( 'ABSPATH' ) ) exit;

class KobaAudioUpdater {
    private $file;
    private $plugin;
    private $basename;
    private $active;
    private $username;
    private $repository;
    private $github_response;

    public function __construct( $file ) {
        $this->file = $file;
        add_action( 'init', array( $this, 'set_plugin_properties' ) );
    }

    public function set_plugin_properties() {
        $this->plugin   = plugin_basename( $this->file );
        $this->basename = plugin_basename( $this->file );
        $this->active   = is_plugin_active( $this->plugin );
    }

    public function set_username( $username ) {
        $this->username = $username;
    }

    public function set_repository( $repository ) {
        $this->repository = $repository;
    }

    public function initialize() {
        add_filter( 'pre_set_site_transient_update_plugins', array( $this, 'modify_transient' ), 10, 1 );
        add_filter( 'plugins_api', array( $this, 'plugin_popup' ), 10, 3 );
        add_filter( 'upgrader_post_install', array( $this, 'after_install' ), 10, 3 );
    }

    public function modify_transient( $transient ) {
        if ( property_exists( $transient, 'checked' ) ) {
            if ( $checked = $transient->checked ) {
                $this->get_repository_info();
                if ( $this->github_response ) {
                    $out_of_date = version_compare( $this->github_response['version'], $checked[ $this->plugin ], 'gt' );
                    if ( $out_of_date ) {
                        $new_files = $this->github_response['download_url'];
                        $slug = current( explode( '/', $this->basename ) );
                        $plugin = array(
                            'plugin'      => $this->plugin, // <--- ADD THIS LINE
                            'url'         => $this->plugin,
                            'slug'        => $slug,
                            'package'     => $new_files,
                            'new_version' => $this->github_response['version'],
                            'tested'      => isset($this->github_response['tested']) ? $this->github_response['tested'] : '6.9',
                            'requires'    => isset($this->github_response['requires']) ? $this->github_response['requires'] : '6.0'
                        );
                        $transient->response[ $this->plugin ] = (object) $plugin;
                    }
                }
            }
        }
        return $transient;
    }

    public function plugin_popup( $result, $action, $args ) {
        if ( ! empty( $args->slug ) ) {
            if ( $args->slug == current( explode( '/' , $this->basename ) ) ) {
                $this->get_repository_info();
                if ( $this->github_response ) {
                    $plugin = array(
                        'plugin'            => $this->plugin, // <--- ADD THIS LINE
                        'name'              => $this->github_response['name'],
                        'slug'              => $this->basename,
                        'version'           => $this->github_response['version'],
                        'author'            => "KOBA-I",
                        'author_profile'    => "https://audio.koba-i.com",
                        'last_updated'      => date('Y-m-d'),
                        'homepage'          => "https://audio.koba-i.com",
                        'short_description' => $this->github_response['sections']['description'],
                        'sections'          => $this->github_response['sections'],
                        'download_link'     => $this->github_response['download_url'],
                        'tested'            => isset($this->github_response['tested']) ? $this->github_response['tested'] : '6.9',
                        'requires'          => isset($this->github_response['requires']) ? $this->github_response['requires'] : '6.0'
                    );
                    return (object) $plugin;
                }
            }
        }
        return $result;
    }

    public function after_install( $response, $hook_extra, $result ) {
        global $wp_filesystem;
        $install_directory = plugin_dir_path( $this->file );
        $wp_filesystem->move( $result['destination'], $install_directory );
        $result['destination'] = $install_directory;
        if ( $this->active ) {
            activate_plugin( $this->plugin );
        }
        return $result;
    }

    private function get_repository_info() {
        if ( is_null( $this->github_response ) ) {
            $request_uri = $this->repository;
            if ( ! $request_uri ) return;
            $response = wp_remote_get( $request_uri );
            if ( ! is_wp_error( $response ) && wp_remote_retrieve_response_code( $response ) === 200 ) {
                $this->github_response = json_decode( wp_remote_retrieve_body( $response ), true );
            }
        }
    }
}