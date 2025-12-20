'use strict';

'require baseclass';

/**
 * Notification display duration for temporary notifications (milliseconds)
 * @constant {number}
 */
const NOTIFICATION_TIMEOUT = 2000;

/**
 * Polling interval for image pull status updates (seconds)
 * @constant {number}
 */
const POLL_INTERVAL = 1;

/**
 * Polling interval for container stats updates (milliseconds)
 * @constant {number}
 */
const STATS_POLL_INTERVAL = 2000;

return baseclass.extend({
	NOTIFICATION_TIMEOUT,
	POLL_INTERVAL,
	STATS_POLL_INTERVAL
});
