import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock the logger
const mockStructuredLogger = {
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
};

jest.mock('../../../src/helpers/logger.js', () => ({
  structuredLogger: mockStructuredLogger
}));

// Import after mocking
import { 
  CloudApiError, 
  CloudApiErrorHandler, 
  ERROR_TYPES, 
  ERROR_SEVERITY 
} from '../../../src/services/errorHandling/CloudApiErrorHandler.js';

describe('CloudApiError', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Error Classification', () => {
    it('should classify authentication errors correctly', () => {
      const error = new CloudApiError('Invalid token', 401, 190);
      expect(error.errorType).toBe(ERROR_TYPES.ACCESS_TOKEN_EXPIRED);
      expect(error.severity).toBe(ERROR_SEVERITY.CRITICAL);
      expect(error.retryable).toBe(false);
    });

    it('should classify rate limit errors correctly', () => {
      const error = new CloudApiError('Rate limit exceeded', 429, 80007);
      expect(error.errorType).toBe(ERROR_TYPES.MESSAGING_LIMIT_EXCEEDED);
      expect(error.severity).toBe(ERROR_SEVERITY.MEDIUM);
      expect(error.retryable).toBe(true);
    });

    it('should classify validation errors correctly', () => {
      const error = new CloudApiError('Invalid phone number', 400, 1);
      expect(error.errorType).toBe(ERROR_TYPES.INVALID_PHONE_NUMBER);
      expect(error.severity).toBe(ERROR_SEVERITY.LOW);
      expect(error.retryable).toBe(false);
    });

    it('should classify server errors correctly', () => {
      const error = new CloudApiError('Internal server error', 500);
      expect(error.errorType).toBe(ERROR_TYPES.SERVER_ERROR);
      expect(error.severity).toBe(ERROR_SEVERITY.HIGH);
      expect(error.retryable).toBe(true);
    });
  });

  describe('User-Friendly Messages', () => {
    it('should provide Portuguese user-friendly messages', () => {
      const authError = new CloudApiError('Auth failed', 401);
      expect(authError.userFriendlyMessage).toContain('autenticação');

      const rateLimitError = new CloudApiError('Rate limit', 429);
      expect(rateLimitError.userFriendlyMessage).toContain('Limite de taxa');

      const phoneError = new CloudApiError('Invalid phone', 400, 1);
      expect(phoneError.userFriendlyMessage).toContain('Número de telefone inválido');
    });
  });

  describe('Error Details', () => {
    it('should provide comprehensive error details', () => {
      const error = new CloudApiError(
        'Test error',
        400,
        100,
        'trace123',
        { error: 'test' },
        { operation: 'test' }
      );

      const details = error.getDetails();
      expect(details).toHaveProperty('errorId');
      expect(details).toHaveProperty('errorType');
      expect(details).toHaveProperty('severity');
      expect(details).toHaveProperty('userFriendlyMessage');
      expect(details.status).toBe(400);
      expect(details.code).toBe(100);
      expect(details.fbtraceId).toBe('trace123');
      expect(details.context).toEqual({ operation: 'test' });
    });
  });
});

describe('CloudApiErrorHandler', () => {
  let errorHandler;

  beforeEach(() => {
    errorHandler = new CloudApiErrorHandler();
    jest.clearAllMocks();
  });

  afterEach(() => {
    errorHandler.clearStats();
  });

  describe('Error Processing', () => {
    it('should handle CloudApiError instances', () => {
      const originalError = new CloudApiError('Test error', 400, 100);
      const processedError = errorHandler.handleError(originalError, { test: 'context' });

      expect(processedError).toBeInstanceOf(CloudApiError);
      expect(processedError.context).toHaveProperty('test', 'context');
      expect(mockStructuredLogger.warn).toHaveBeenCalled();
    });

    it('should convert generic errors to CloudApiError', () => {
      const genericError = new Error('Generic error');
      const processedError = errorHandler.handleError(genericError, { operation: 'test' });

      expect(processedError).toBeInstanceOf(CloudApiError);
      expect(processedError.context).toHaveProperty('operation', 'test');
      expect(processedError.errorType).toBe(ERROR_TYPES.UNKNOWN_ERROR);
    });
  });

  describe('Error Statistics', () => {
    it('should track error statistics', () => {
      const error1 = new CloudApiError('Error 1', 400, 100);
      const error2 = new CloudApiError('Error 2', 400, 100);
      const error3 = new CloudApiError('Error 3', 500);

      errorHandler.handleError(error1);
      errorHandler.handleError(error2);
      errorHandler.handleError(error3);

      const stats = errorHandler.getErrorStats();
      expect(stats.totalErrors).toBe(3);
    });
  });

  describe('Alert Thresholds', () => {
    it('should trigger alerts when thresholds are exceeded', () => {
      // Set low threshold for testing
      errorHandler.setAlertThresholds({ [ERROR_SEVERITY.LOW]: 2 });

      const error = new CloudApiError('Test error', 400, 100); // LOW severity

      // First error - no alert
      errorHandler.handleError(error);
      expect(mockStructuredLogger.error).toHaveBeenCalledTimes(0);

      // Second error - should trigger alert
      errorHandler.handleError(error);
      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('ALERT: High frequency'),
        expect.any(Object)
      );
    });
  });
});