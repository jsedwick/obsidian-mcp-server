/**
 * dateFormat utility unit tests
 */

import { describe, it, expect } from 'vitest';
import {
  formatLocalDateTime,
  formatLocalDate,
  formatLocalTime,
  formatLocalDateTimeFriendly,
  getTodayLocal,
} from '../../../src/utils/dateFormat.js';

describe('dateFormat', () => {
  describe('formatLocalDateTime', () => {
    it('should return ISO-like string with timezone offset', () => {
      const date = new Date(2026, 0, 26, 22, 0, 0);
      const result = formatLocalDateTime(date);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
    });

    it('should use local date components (not UTC)', () => {
      const date = new Date(2026, 0, 26, 22, 30, 45);
      const result = formatLocalDateTime(date);
      expect(result).toContain('2026-01-26');
      expect(result).toContain('T22:30:45');
    });

    it('should pad single-digit months and days', () => {
      const date = new Date(2026, 2, 5, 8, 5, 3);
      const result = formatLocalDateTime(date);
      expect(result).toContain('2026-03-05');
      expect(result).toContain('T08:05:03');
    });

    it('should include timezone offset in correct format', () => {
      const date = new Date();
      const result = formatLocalDateTime(date);
      const tzPart = result.slice(-6);
      expect(tzPart).toMatch(/^[+-]\d{2}:\d{2}$/);
    });
  });

  describe('formatLocalDate', () => {
    it('should return YYYY-MM-DD format', () => {
      const date = new Date(2026, 0, 26);
      expect(formatLocalDate(date)).toBe('2026-01-26');
    });

    it('should use local date (not UTC) — avoids midnight rollover', () => {
      const date = new Date(2026, 0, 26, 22, 0, 0);
      expect(formatLocalDate(date)).toBe('2026-01-26');
    });

    it('should pad single-digit months and days', () => {
      expect(formatLocalDate(new Date(2026, 0, 5))).toBe('2026-01-05');
      expect(formatLocalDate(new Date(2026, 8, 1))).toBe('2026-09-01');
    });

    it('should handle Dec 31 / Jan 1 boundary', () => {
      const dec31 = new Date(2025, 11, 31, 23, 59, 59);
      expect(formatLocalDate(dec31)).toBe('2025-12-31');

      const jan1 = new Date(2026, 0, 1, 0, 0, 0);
      expect(formatLocalDate(jan1)).toBe('2026-01-01');
    });
  });

  describe('formatLocalTime', () => {
    it('should return human-readable time with timezone', () => {
      const date = new Date(2026, 0, 26, 22, 0, 0);
      const result = formatLocalTime(date);
      expect(result).toMatch(/10:00\s*(PM|pm)/);
      expect(result).toMatch(/[A-Z]{2,4}$/);
    });

    it('should handle AM times', () => {
      const date = new Date(2026, 0, 26, 8, 30, 0);
      expect(formatLocalTime(date)).toMatch(/8:30\s*(AM|am)/);
    });

    it('should handle midnight', () => {
      const date = new Date(2026, 0, 26, 0, 0, 0);
      expect(formatLocalTime(date)).toMatch(/12:00\s*(AM|am)/);
    });

    it('should handle noon', () => {
      const date = new Date(2026, 0, 26, 12, 0, 0);
      expect(formatLocalTime(date)).toMatch(/12:00\s*(PM|pm)/);
    });
  });

  describe('formatLocalDateTimeFriendly', () => {
    it('should return full human-readable date and time', () => {
      const date = new Date(2026, 0, 26, 22, 0, 0);
      const result = formatLocalDateTimeFriendly(date);
      expect(result).toContain('Monday');
      expect(result).toContain('January');
      expect(result).toContain('26');
      expect(result).toContain('2026');
      expect(result).toMatch(/10:00\s*(PM|pm)/);
    });
  });

  describe('getTodayLocal', () => {
    it('should return today in YYYY-MM-DD format', () => {
      expect(getTodayLocal()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should match formatLocalDate with current date', () => {
      expect(getTodayLocal()).toBe(formatLocalDate(new Date()));
    });
  });
});
