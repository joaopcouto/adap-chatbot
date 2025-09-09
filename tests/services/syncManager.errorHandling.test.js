import { jest } from '@jest/globals';
import syncManager from '../../src/services/syncManager.js';

describe('SyncManager Error Handling', () => {
  describe('_classifyError', () => {
    test('should handle undefined error gracefully', () => {
      const result = syncManager._classifyError(undefined);
      
      expect(result).toEqual({
        type: 'UNKNOWN_ERROR',
        retryable: false,
        requiresReconnection: false
      });
    });

    test('should handle null error gracefully', () => {
      const result = syncManager._classifyError(null);
      
      expect(result).toEqual({
        type: 'UNKNOWN_ERROR',
        retryable: false,
        requiresReconnection: false
      });
    });

    test('should handle error with proper type classification', () => {
      const error = new Error('Test error');
      error.type = 'AUTH_ERROR';
      error.retryable = false;
      error.requiresReconnection = true;
      
      const result = syncManager._classifyError(error);
      
      expect(result).toEqual({
        type: 'AUTH_ERROR',
        retryable: false,
        requiresReconnection: true
      });
    });

    test('should fallback to status-based classification when type is missing', () => {
      const error = new Error('Unauthorized');
      error.status = 401;
      
      const result = syncManager._classifyError(error);
      
      expect(result.type).toBe('AUTH_ERROR');
      expect(result.retryable).toBe(false);
    });

    test('should handle malformed error objects', () => {
      const malformedError = { someProperty: 'value' }; // Not a proper Error object
      
      const result = syncManager._classifyError(malformedError);
      
      expect(result.type).toBe('UNKNOWN_ERROR');
      expect(result.retryable).toBe(false);
      expect(result.requiresReconnection).toBe(false);
    });
  });
});