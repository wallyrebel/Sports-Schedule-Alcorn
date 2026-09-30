<?php
// Exercise importer behavior with an in-memory WordPress/TEC boundary.
define('ABSPATH', __DIR__);
$options = array(); $posts = array(); $next_id = 100; $response_code = 200; $creates = 0;
class WP_Error { public $message; function __construct($code, $message, $data = null) { $this->message = $message; } }
function register_activation_hook(...$args) {} function register_deactivation_hook(...$args) {} function add_action(...$args) {} function add_shortcode(...$args) {}
function wp_next_scheduled(...$args) { return false; } function wp_schedule_single_event(...$args) {}
function get_option($key, $default = false) { return $GLOBALS['options'][$key] ?? $default; }
function add_option($key, $value, ...$rest) { if (isset($GLOBALS['options'][$key])) return false; $GLOBALS['options'][$key] = $value; return true; }
function update_option($key, $value, ...$rest) { $GLOBALS['options'][$key] = $value; }
function delete_option($key) { unset($GLOBALS['options'][$key]); }
function wp_safe_remote_get($url, $args) { return array('body' => json_encode($GLOBALS['feed']), 'code' => $GLOBALS['response_code']); }
function wp_remote_retrieve_response_code($response) { return $response['code']; }
function wp_remote_retrieve_body($response) { return $response['body']; }
function is_wp_error($value) { return $value instanceof WP_Error; }
function wp_parse_url($url, $part) { return parse_url($url, $part); }
function wp_json_encode($data) { return json_encode($data); }
function sanitize_text_field($value) { return strip_tags($value); }
function esc_html($value) { return htmlspecialchars($value, ENT_QUOTES); }
function esc_url($value) { return $value; } function esc_url_raw($value) { return $value; }
function get_post_type($id) { return $GLOBALS['posts'][$id]['post_type'] ?? false; }
function get_post_status($id) { return $GLOBALS['posts'][$id]['post_status'] ?? false; }
function get_post_meta($id, $key, $single) { return $GLOBALS['posts'][$id]['meta'][$key] ?? ''; }
function update_post_meta($id, $key, $value) { $GLOBALS['posts'][$id]['meta'][$key] = $value; }
function get_posts($args) { return array_keys(array_filter($GLOBALS['posts'], function ($p) use ($args) { return ($p['meta'][$args['meta_key']] ?? '') === $args['meta_value']; })); }
function tribe_create_event($args) { $GLOBALS['creates']++; return tribe_update_event(++$GLOBALS['next_id'], $args); }
function tribe_update_event($id, $args) {
    $meta = $GLOBALS['posts'][$id]['meta'] ?? array();
    $GLOBALS['posts'][$id] = $args; $GLOBALS['posts'][$id]['meta'] = array_merge($meta, $args['meta_input']);
    // Match TEC's separate date/time contract; datetime-only arguments lose timed dates.
    $has_dates = $args['EventAllDay'] || (isset($args['EventStartTime'], $args['EventEndTime']));
    if ($has_dates) {
        update_post_meta($id, '_EventStartDate', $args['EventStartDate'] . ' ' . ($args['EventAllDay'] ? '00:00:00' : $args['EventStartTime']));
        update_post_meta($id, '_EventEndDate', $args['EventEndDate'] . ' ' . ($args['EventAllDay'] ? '23:59:59' : $args['EventEndTime']));
    }
    return $id;
}
function wp_set_object_terms(...$args) {}
function wp_update_post($args) { $GLOBALS['posts'][$args['ID']] = array_merge($GLOBALS['posts'][$args['ID']], $args); return $args['ID']; }
function get_permalink($id) { return 'https://alcornsportsms.com/event/' . $id . '/'; }
require __DIR__ . '/../wordpress/alcorn-sports-sync/alcorn-sports-sync.php';
function check($truth, $message) { if (!$truth) throw new RuntimeException($message); echo "PASS: $message\n"; }
$event = array('id' => 'game1', 'date' => '2030-10-02', 'time' => '19:00', 'gender' => 'Boys', 'sport' => 'Football', 'level' => 'Varsity', 'schools' => array('Corinth'), 'participants' => array(array('name' => 'Corinth')), 'title' => 'South Pontotoc at Corinth', 'location' => 'Corinth, MS', 'status' => 'scheduled', 'sourceUrl' => 'https://www.maxpreps.com/ms/corinth/corinth-warriors/football/schedule/');
$feed = array('timezone' => 'America/Chicago', 'lastChecked' => '2030-09-30T10:00:00Z', 'schools' => array_map(function ($name) { return array('name' => $name); }, ACS_SCHOOLS), 'events' => array($event), 'coverage' => array());
check(acs_sync() === true && $creates === 1, 'creates a native WordPress event');
$id = 101;
check($posts[$id]['EventAllDay'] === false && $posts[$id]['EventTimezone'] === 'America/Chicago' && get_post_meta($id, '_EventStartDate', true) === '2030-10-02 19:00:00', 'timed games save a real start date in Central timezone');
check(acs_sync() === true && $creates === 1, 'repeated import is idempotent');
$feed['events'][0]['time'] = '18:00';
check(acs_sync() === true && $creates === 1 && get_post_meta($id, '_EventStartDate', true) === '2030-10-02 18:00:00', 'rescheduling updates the same event');
update_post_meta($id, '_EventStartDate', '');
check(acs_sync() === true && $creates === 1 && get_post_meta($id, '_EventStartDate', true) === '2030-10-02 18:00:00', 'repairs missing native dates even when the source is unchanged');
$feed['events'][0]['status'] = 'cancelled';
check(acs_sync() === true && str_starts_with($posts[$id]['post_title'], 'CANCELLED:'), 'cancellations are visible');
$feed['events'][0]['time'] = null;
check(acs_sync() === true && $posts[$id]['EventAllDay'] === true && str_contains($posts[$id]['post_title'], 'time TBD'), 'unknown times never appear as midnight games');
$snapshot = get_option('acs_schedule'); $response_code = 503;
check(is_wp_error(acs_sync()) && get_option('acs_schedule') === $snapshot, 'source outage retains last good schedule');
$response_code = 200; $feed['events'][0]['schools'] = array('Ripley');
check(is_wp_error(acs_sync()) && get_option('acs_schedule') === $snapshot, 'out-of-county data is rejected');
$feed['events'][0]['schools'] = array('Corinth'); $feed['events'][0]['gender'] = 'Boys & Girls'; $feed['events'][0]['sourceUrl'] = 'https://ms.milesplit.com/meets/720537/info';
check(acs_sync() === true, 'accepts county varsity meet data from MileSplit');
$posts[999] = array('post_type' => 'tribe_events', 'post_status' => 'publish', 'meta' => array('_EventStartDate' => '2030-10-02 19:00:00'));
$feed['events'] = array();
check(acs_sync() === true && $posts[$id]['post_status'] === 'draft', 'removed future source event is retired reversibly');
check($posts[999]['post_status'] === 'publish', 'manual and unrelated events are preserved');
$feed['events'] = array();
for ($i = 0; $i < 75; $i++) { $copy = $event; $copy['id'] = 'batch-' . $i; $feed['events'][] = $copy; }
check(acs_sync() === false && get_option('acs_import_pending'), 'large import splits into bounded batches');
for ($i = 0; $i < 5 && get_option('acs_import_pending'); $i++) { acs_sync(); }
check(!get_option('acs_import_pending') && count(get_option('acs_schedule')['events']) === 75 && $creates === 76, 'batch retries finish without duplicate events');
echo "WordPress importer integration tests passed.\n";
