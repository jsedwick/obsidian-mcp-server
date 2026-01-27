/**
 * Centralized date/time formatting utilities.
 *
 * All timestamps displayed to users should use local timezone (typically Pacific Time).
 * Internal storage can remain UTC/ISO-8601, but user-facing output should be localized.
 *
 * Related: Session 2025-11-18_21-17-46_session-timezone-fix (original timezone fix)
 */

/**
 * Format a Date as a local timezone ISO-like string.
 * Example: "2026-01-26T22:00:00-08:00" (Pacific Time)
 *
 * Unlike toISOString() which always returns UTC (ending in Z),
 * this returns the local timezone with proper offset.
 */
export function formatLocalDateTime(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');

  // Get timezone offset in +/-HH:MM format
  const tzOffset = -date.getTimezoneOffset();
  const tzHours = Math.floor(Math.abs(tzOffset) / 60);
  const tzMinutes = Math.abs(tzOffset) % 60;
  const tzSign = tzOffset >= 0 ? '+' : '-';
  const tzString = `${tzSign}${String(tzHours).padStart(2, '0')}:${String(tzMinutes).padStart(2, '0')}`;

  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}${tzString}`;
}

/**
 * Format a Date as local timezone date only (YYYY-MM-DD).
 *
 * This is timezone-safe for dates - a session at 10pm PST on Jan 26
 * will correctly return "2026-01-26" instead of "2026-01-27" (which
 * toISOString().split('T')[0] would return due to UTC conversion).
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');

  return `${year}-${month}-${day}`;
}

/**
 * Format a Date as a human-readable local time string.
 * Example: "10:00 PM PST" or "10:00 PM PDT"
 *
 * Uses Intl.DateTimeFormat for proper timezone abbreviation.
 */
export function formatLocalTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Format a Date as a human-readable local date and time.
 * Example: "Sunday, January 26, 2026 at 10:00 PM PST"
 */
export function formatLocalDateTimeFriendly(date: Date): string {
  return date.toLocaleString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/**
 * Get current date in local timezone (YYYY-MM-DD).
 * Convenience function to replace `new Date().toISOString().split('T')[0]`
 */
export function getTodayLocal(): string {
  return formatLocalDate(new Date());
}
