<?php
/**
 * Plugin Name: Alcorn Sports Schedule Sync
 * Description: Imports Alcorn County boys and girls varsity schedules into The Events Calendar and displays a filterable schedule.
 * Version: 1.0.2
 * Requires PHP: 8.0
 * Requires Plugins: the-events-calendar
 * Author: Alcorn County Sports
 */
if (!defined('ABSPATH')) { exit; }

const ACS_FEED = 'https://raw.githubusercontent.com/wallyrebel/Sports-Schedule-Alcorn/main/docs/schedule.json';
const ACS_SCHOOLS = array('Corinth', 'Kossuth', 'Biggersville', 'Alcorn Central');

register_activation_hook(__FILE__, function () {
    if (!wp_next_scheduled('acs_hourly_sync')) { wp_schedule_event(time() + 10, 'hourly', 'acs_hourly_sync'); }
});
register_deactivation_hook(__FILE__, function () { wp_clear_scheduled_hook('acs_hourly_sync'); wp_clear_scheduled_hook('acs_continue_sync'); });
add_action('acs_hourly_sync', 'acs_sync');
add_action('acs_continue_sync', 'acs_sync');

function acs_validate_feed($data) {
    if (!is_array($data) || ($data['timezone'] ?? '') !== 'America/Chicago' || empty($data['lastChecked']) || !isset($data['events'], $data['schools']) || !is_array($data['events']) || count($data['events']) > 10000) {
        throw new RuntimeException('Invalid calendar feed. Previous schedule retained.');
    }
    $names = array_column($data['schools'], 'name'); sort($names); $expected = ACS_SCHOOLS; sort($expected);
    if ($names !== $expected) { throw new RuntimeException('Feed must contain exactly the four Alcorn County schools.'); }
    $ids = array();
    foreach ($data['events'] as $e) {
        if (empty($e['id']) || isset($ids[$e['id']]) || !in_array($e['gender'] ?? '', array('Boys', 'Girls', 'Boys & Girls'), true) || ($e['level'] ?? '') !== 'Varsity' || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $e['date'] ?? '') || (!is_null($e['time']) && !preg_match('/^(?:[01]\d|2[0-3]):[0-5]\d$/', $e['time'])) || !in_array($e['status'] ?? '', array('scheduled', 'postponed', 'cancelled'), true) || empty($e['schools']) || array_diff($e['schools'], ACS_SCHOOLS) || !array_intersect(array_column($e['participants'] ?? array(), 'name'), ACS_SCHOOLS) || !preg_match('/^(www\.maxpreps\.com|(?:[a-z]{2,3}\.)?milesplit\.com)$/', wp_parse_url($e['sourceUrl'] ?? '', PHP_URL_HOST) ?? '') || wp_parse_url($e['sourceUrl'] ?? '', PHP_URL_SCHEME) !== 'https') {
            throw new RuntimeException('Invalid or out-of-county event. Previous schedule retained.');
        }
        $ids[$e['id']] = true;
    }
    return $data;
}

function acs_sync() {
    if (!function_exists('tribe_create_event') || !function_exists('tribe_update_event')) { return new WP_Error('acs_dependency', 'The Events Calendar must be active.'); }
    // add_option provides an atomic lock; no request-supplied URL, data, or credentials are accepted.
    $lock = (int) get_option('acs_sync_lock', 0);
    if ($lock && $lock < time() - 600) { delete_option('acs_sync_lock'); }
    if (!add_option('acs_sync_lock', time(), '', false)) { return false; }
    update_option('acs_last_attempt', time(), false);
    try {
        $pending = get_option('acs_import_pending');
        if ($pending) { $data = acs_validate_feed($pending); }
        else {
            $response = wp_safe_remote_get(ACS_FEED . '?v=' . floor(time() / 300), array('timeout' => 30, 'limit_response_size' => 5000000));
            if (is_wp_error($response) || wp_remote_retrieve_response_code($response) !== 200) { throw new RuntimeException('Calendar source could not be reached. Previous schedule retained.'); }
            $data = acs_validate_feed(json_decode(wp_remote_retrieve_body($response), true));
        }
        $existing_data = get_option('acs_schedule', array());
        if (($existing_data['lastChecked'] ?? '') > $data['lastChecked']) { throw new RuntimeException('Older feed rejected. Previous schedule retained.'); }
        $index = get_option('acs_event_index', array()); $seen = array(); $changed = 0; $deadline = microtime(true) + 12;
        foreach ($data['events'] as &$event) {
            $key = hash('sha256', $event['id']); $seen[$key] = true;
            $id = isset($index[$key]) ? (int) $index[$key] : 0;
            if ($id && (get_post_type($id) !== 'tribe_events' || get_post_meta($id, '_acs_key', true) !== $key)) { $id = 0; }
            // Recover if a previous request stopped after event insertion but before indexing.
            if (!$id) {
                $found = get_posts(array('post_type' => 'tribe_events', 'post_status' => 'any', 'meta_key' => '_acs_key', 'meta_value' => $key, 'fields' => 'ids', 'numberposts' => 1));
                $id = $found ? (int) $found[0] : 0;
            }
            $hash = hash('sha256', wp_json_encode(array($event['date'], $event['time'], $event['status'], $event['title'], $event['location'], $event['sourceUrl'], $event['schools'], $event['sport'], $event['gender'])));
            $start = new DateTimeImmutable($event['date'] . ' ' . ($event['time'] ?? '00:00'), new DateTimeZone('America/Chicago'));
            $all_day = is_null($event['time']);
            $end = $all_day ? $start->setTime(23, 59, 59) : $start->modify('+2 hours');
            if (!$id || get_post_meta($id, '_acs_hash', true) !== $hash || get_post_status($id) !== 'publish' || get_post_meta($id, '_EventStartDate', true) !== $start->format('Y-m-d H:i:s') || get_post_meta($id, '_EventEndDate', true) !== $end->format('Y-m-d H:i:s')) {
                // Keep requests short on shared hosting. Completed rows are idempotent,
                // and the next batch resumes from the saved index without duplicating events.
                if ($changed >= 30 || ($changed && microtime(true) > $deadline)) {
                    update_option('acs_import_pending', $data, false);
                    if (!wp_next_scheduled('acs_continue_sync')) { wp_schedule_single_event(time() + 5, 'acs_continue_sync'); }
                    return false;
                }
                $title = ($event['status'] === 'scheduled' ? '' : strtoupper($event['status']) . ': ') . $event['gender'] . ' ' . $event['sport'] . ': ' . $event['title'] . ($all_day ? ' (time TBD)' : '');
                $content = '<p>Boys and girls varsity sports for Alcorn County. All times Central.</p><p>' . esc_html($event['location']) . '</p>';
                $content .= '<p>' . ($all_day ? 'Start time has not been announced.' : 'Start time: ' . esc_html($start->format('g:i a T')) . '. End time is an estimate for calendar display.') . '</p>';
                if ($event['status'] !== 'scheduled') { $content .= '<p><strong>' . esc_html(ucfirst($event['status'])) . '. Check the source for details.</strong></p>'; }
                $content .= '<p>' . esc_html($event['note'] ?? '') . '</p>';
                $content .= '<p>Schedule subject to change. <a href="' . esc_url($event['sourceUrl']) . '">View the source schedule</a>.</p>';
                $args = array('post_title' => sanitize_text_field($title), 'post_content' => $content, 'post_status' => 'publish', 'post_type' => 'tribe_events', 'comment_status' => 'closed',
                    // TEC requires separate time fields for timed events, even when a datetime is supplied.
                    'EventStartDate' => $start->format('Y-m-d'), 'EventStartTime' => $start->format('H:i:s'),
                    'EventEndDate' => $end->format('Y-m-d'), 'EventEndTime' => $end->format('H:i:s'),
                    'EventTimezone' => 'America/Chicago', 'EventAllDay' => $all_day, 'EventShowMap' => false, 'EventShowMapLink' => false, 'EventURL' => esc_url_raw($event['sourceUrl']),
                    'meta_input' => array('_acs_key' => $key));
                $result = $id ? tribe_update_event($id, $args) : tribe_create_event($args);
                if (is_wp_error($result) || !$result) { throw new RuntimeException('Could not save an event; import will retry.'); }
                $id = (int) $result;
                if (get_post_meta($id, '_EventStartDate', true) !== $start->format('Y-m-d H:i:s') || get_post_meta($id, '_EventEndDate', true) !== $end->format('Y-m-d H:i:s')) { throw new RuntimeException('Calendar did not save the expected game dates; import will retry.'); }
                update_post_meta($id, '_acs_key', $key); update_post_meta($id, '_acs_hash', $hash);
                update_post_meta($id, '_acs_source_status', $event['status']);
                $terms = array_merge(array('Alcorn County Varsity', $event['gender'], $event['sport']), $event['schools']);
                wp_set_object_terms($id, $terms, 'tribe_events_cat');
                $index[$key] = $id;
                update_option('acs_event_index', $index, false);
                $changed++;
            }
            $event['eventUrl'] = get_permalink($id);
            $event['eventId'] = $id;
        }
        unset($event);
        // Only retire this importer's missing FUTURE events; retain historical and manual events.
        $today = (new DateTimeImmutable('now', new DateTimeZone('America/Chicago')))->format('Y-m-d');
        foreach ($index as $key => $id) {
            if (!isset($seen[$key]) && get_post_meta($id, '_acs_key', true) === $key && substr((string) get_post_meta($id, '_EventStartDate', true), 0, 10) >= $today && get_post_status($id) === 'publish') {
                wp_update_post(array('ID' => $id, 'post_status' => 'draft'));
            }
        }
        update_option('acs_schedule', $data, false);
        delete_option('acs_import_pending');
        update_option('acs_last_success', time(), false);
        delete_option('acs_sync_error');
        return true;
    } catch (Throwable $error) {
        update_option('acs_sync_error', sanitize_text_field($error->getMessage()), false);
        return new WP_Error('acs_sync', $error->getMessage());
    } finally { delete_option('acs_sync_lock'); }
}

add_action('rest_api_init', function () {
    register_rest_route('alcorn-sports/v1', '/schedule', array('methods' => 'GET', 'permission_callback' => '__return_true', 'callback' => function () {
        // Public cached data reader. Refresh is rate-limited and pulls only our fixed, validated source.
        $interval = get_option('acs_import_pending') ? 15 : 300;
        if ((int) get_option('acs_last_attempt', 0) < time() - $interval) { acs_sync(); }
        $data = get_option('acs_schedule', array());
        // A first import must not leave the public list empty while native events are batched.
        // The pending feed has already passed the same school/varsity/source validation.
        if (!$data && get_option('acs_import_pending')) {
            $data = get_option('acs_import_pending');
            $data['importPending'] = true;
            foreach ($data['events'] as &$event) { unset($event['eventUrl'], $event['eventId']); }
            unset($event);
        }
        if (!$data) { return new WP_Error('acs_unavailable', 'Schedule is updating. Please try again shortly.', array('status' => 503)); }
        $data['wordpressSyncedAt'] = gmdate('c', (int) get_option('acs_last_success', 0));
        $data['syncError'] = get_option('acs_sync_error', '');
        $response = rest_ensure_response($data); $response->header('Cache-Control', 'no-store'); return $response;
    }));
});

add_shortcode('alcorn_sports_schedule', function () {
    wp_enqueue_style('alcorn-sports-schedule', plugins_url('calendar.css', __FILE__), array(), '1.0.2');
    wp_enqueue_script('alcorn-sports-schedule', plugins_url('calendar.js', __FILE__), array(), '1.0.2', true);
    return '<div class="acs-calendar" data-feed="' . esc_url(rest_url('alcorn-sports/v1/schedule')) . '" data-month-url="' . esc_url(home_url('/events/month/')) . '"><p role="status">Loading Alcorn County varsity schedules…</p></div><noscript><p><a href="' . esc_url(home_url('/events/')) . '">View the sports calendar</a></p></noscript>';
});

add_action('admin_menu', function () {
    add_submenu_page('edit.php?post_type=tribe_events', 'Alcorn Schedule Sync', 'Alcorn Schedule Sync', 'manage_options', 'alcorn-sports-sync', function () {
        if (!current_user_can('manage_options')) { return; }
        if (isset($_POST['acs_refresh'])) { check_admin_referer('acs_refresh'); acs_sync(); }
        $data = get_option('acs_schedule', array());
        echo '<div class="wrap"><h1>Alcorn Schedule Sync</h1><p>Corinth, Kossuth, Biggersville and Alcorn Central. Boys and girls varsity only.</p>';
        echo '<p>Hourly source checks run in <a href="https://github.com/wallyrebel/Sports-Schedule-Alcorn/actions">Sports-Schedule-Alcorn on GitHub</a>. WordPress imports hourly and refreshes its cache when this schedule is requested.</p>';
        echo '<p>Source checked: <strong>' . esc_html($data['lastChecked'] ?? 'Not yet') . '</strong><br>WordPress last synced: ' . esc_html(get_option('acs_last_success') ? wp_date('M j, Y g:i a T', get_option('acs_last_success'), new DateTimeZone('America/Chicago')) : 'Not yet') . '<br>Imported events: ' . count($data['events'] ?? array()) . '</p>';
        if (get_option('acs_sync_error')) { echo '<p role="alert">' . esc_html(get_option('acs_sync_error')) . '</p>'; }
        if (get_option('acs_import_pending')) { echo '<p>Initial import is continuing in small batches. Events indexed: ' . count(get_option('acs_event_index', array())) . '. You can click Sync now to advance a batch.</p>'; }
        echo '<form method="post">'; wp_nonce_field('acs_refresh'); submit_button('Sync now', 'primary', 'acs_refresh'); echo '</form>';
        echo '<p>Use shortcode <code>[alcorn_sports_schedule]</code> on the Schedule page. Managed events update automatically; edit source schedules on MaxPreps to make lasting corrections.</p>';
        echo '<table class="widefat"><thead><tr><th>School</th><th>Team</th><th>Upcoming</th><th>Source status</th></tr></thead><tbody>';
        foreach ($data['coverage'] ?? array() as $row) { echo '<tr><td>' . esc_html($row['school']) . '</td><td>' . esc_html($row['gender'] . ' ' . $row['sport']) . '</td><td>' . (int) $row['upcoming'] . '</td><td>' . esc_html($row['error'] ?? ($row['note'] ?: 'Checked')) . '</td></tr>'; }
        echo '</tbody></table></div>';
    });
});
