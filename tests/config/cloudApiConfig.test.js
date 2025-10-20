import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

describe('CloudApiConfigManager', () => {
  let originalEnv;
  let CloudApiConfigManager;

  beforeEach(async () => {
    // Save original environment
    originalEnv = { ...process.env };
    
    // Clear environment variables that might interfere with tests
    delete process.env.WHATSAPP_ACCESS_TOKEN;
    delete process.env.META_WA_ACCESS_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.META_WA_PHONE_NUMBER_ID;
    delete process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN;
    delete process.env.META_WA_VERIFY_TOKEN;
    delete process.env.WHATSAPP_API_VERSION;
    delete process.env.META_WA_VERSION;
    delete process.env.WHATSAPP_CLOUD_API_ENABLED;
    delete process.env.WHATSAPP_CLOUD_API_MIGRATION_MODE;
    delete process.env.WHATSAPP_CLOUD_API_URL;
    delete process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
    
    // Clear module cache to get fresh instances
    jest.resetModules();
    
    // Import fresh module
    const module = await import('../../src/config/cloudApiConfig.js');
    CloudApiConfigManager = module.CloudApiConfigManager;
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    jest.resetModules();
  });

  describe('Configuration Loading', () => {
    test('should load configuration with default values', () => {
      // Set minimal required environment variables
      process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-12345678901234567890123456789012345678901234567890';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890123456';
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token-123';
      process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';

      const config = new CloudApiConfigManager();
      const configData = config.getConfig();

      expect(configData.apiVersion).toBe('v18.0');
      expect(configData.baseUrl).toBe('https://graph.facebook.com');
      expect(configData.maxRetries).toBe(3);
      expect(configData.requestTimeoutMs).toBe(30000);
    });

    test('should load configuration from META_WA environment variables', () => {
      process.env.META_WA_ACCESS_TOKEN = 'meta-token-12345678901234567890123456789012345678901234567890';
      process.env.META_WA_PHONE_NUMBER_ID = '9876543210987654';
      process.env.META_WA_VERIFY_TOKEN = 'meta-webhook-token-123';
      process.env.META_WA_VERSION = 'v19.0';
      process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';

      const config = new CloudApiConfigManager();
      const configData = config.getConfig();

      expect(configData.accessToken).toBe('meta-token-12345678901234567890123456789012345678901234567890');
      expect(configData.phoneNumberId).toBe('9876543210987654');
      expect(configData.webhookVerifyToken).toBe('meta-webhook-token-123');
      expect(configData.apiVersion).toBe('v19.0');
    });
  });

  describe('Feature Flags', () => {
    test('should detect when Cloud API is enabled', () => {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-12345678901234567890123456789012345678901234567890';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890123456';
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token-123';
      process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';

      const config = new CloudApiConfigManager();
      expect(config.isEnabled()).toBe(true);
    });

    test('should detect when migration mode is enabled', () => {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-12345678901234567890123456789012345678901234567890';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890123456';
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token-123';
      process.env.WHATSAPP_CLOUD_API_MIGRATION_MODE = 'true';

      const config = new CloudApiConfigManager();
      expect(config.isMigrationMode()).toBe(true);
    });
  });

  describe('URL Generation', () => {
    beforeEach(() => {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-12345678901234567890123456789012345678901234567890';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890123456';
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token-123';
      process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';
    });

    test('should generate correct API URL', () => {
      const config = new CloudApiConfigManager();
      const url = config.getApiUrl('messages');
      expect(url).toBe('https://graph.facebook.com/v18.0/1234567890123456/messages');
    });

    test('should generate base API URL without endpoint', () => {
      const config = new CloudApiConfigManager();
      const url = config.getApiUrl();
      expect(url).toBe('https://graph.facebook.com/v18.0/1234567890123456');
    });

    test('should handle base URL with trailing slash', () => {
      process.env.WHATSAPP_CLOUD_API_URL = 'https://graph.facebook.com/';
      const config = new CloudApiConfigManager();
      const url = config.getApiUrl('messages');
      expect(url).toBe('https://graph.facebook.com/v18.0/1234567890123456/messages');
    });
  });

  describe('Phone Number Formatting', () => {
    beforeEach(() => {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-12345678901234567890123456789012345678901234567890';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890123456';
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token-123';
      process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';
    });

    test('should format Brazilian phone numbers correctly', () => {
      const config = new CloudApiConfigManager();
      
      expect(config.formatPhoneNumber('11987654321')).toBe('5511987654321');
      expect(config.formatPhoneNumber('(11) 98765-4321')).toBe('5511987654321');
      expect(config.formatPhoneNumber('+55 11 98765-4321')).toBe('5511987654321');
      expect(config.formatPhoneNumber('5511987654321')).toBe('5511987654321');
    });

    test('should handle 10-digit numbers', () => {
      const config = new CloudApiConfigManager();
      expect(config.formatPhoneNumber('1234567890')).toBe('55111234567890');
    });

    test('should throw error for invalid phone numbers', () => {
      const config = new CloudApiConfigManager();
      
      expect(() => config.formatPhoneNumber('')).toThrow('Phone number is required');
      expect(() => config.formatPhoneNumber('123')).toThrow('Invalid phone number format');
      expect(() => config.formatPhoneNumber('12345678901234567890')).toThrow('Invalid phone number format');
    });
  });

  describe('Message Content Validation', () => {
    beforeEach(() => {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-12345678901234567890123456789012345678901234567890';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890123456';
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token-123';
      process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';
    });

    test('should validate text message content', () => {
      const config = new CloudApiConfigManager();
      
      expect(config.validateMessageContent('Hello, World!')).toBe(true);
      expect(config.validateMessageContent('A'.repeat(4096))).toBe(true);
    });

    test('should validate caption content', () => {
      const config = new CloudApiConfigManager();
      
      expect(config.validateMessageContent('Image caption', 'caption')).toBe(true);
      expect(config.validateMessageContent('A'.repeat(1024), 'caption')).toBe(true);
    });

    test('should throw error for invalid content', () => {
      const config = new CloudApiConfigManager();
      
      expect(() => config.validateMessageContent('')).toThrow('Message content must be a non-empty string');
      expect(() => config.validateMessageContent(null)).toThrow('Message content must be a non-empty string');
      expect(() => config.validateMessageContent('A'.repeat(4097))).toThrow('Message content exceeds 4096 character limit');
      expect(() => config.validateMessageContent('A'.repeat(1025), 'caption')).toThrow('Message content exceeds 1024 character limit');
    });
  });

  describe('Request Configuration', () => {
    beforeEach(() => {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-12345678901234567890123456789012345678901234567890';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890123456';
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token-123';
      process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';
    });

    test('should generate correct request headers', () => {
      const config = new CloudApiConfigManager();
      const headers = config.getRequestHeaders();
      
      expect(headers.Authorization).toBe('Bearer test-token-12345678901234567890123456789012345678901234567890');
      expect(headers['Content-Type']).toBe('application/json');
      expect(headers['User-Agent']).toBe('WhatsApp-Cloud-API-Client/1.0');
    });

    test('should provide retry configuration', () => {
      const config = new CloudApiConfigManager();
      const retryConfig = config.getRetryConfig();
      
      expect(retryConfig.maxRetries).toBe(3);
      expect(retryConfig.baseDelayMs).toBe(1000);
      expect(retryConfig.maxDelayMs).toBe(30000);
      expect(retryConfig.backoffMultiplier).toBe(2);
      expect(retryConfig.jitterFactor).toBe(0.1);
    });

    test('should provide timeout configuration', () => {
      const config = new CloudApiConfigManager();
      const timeoutConfig = config.getTimeoutConfig();
      
      expect(timeoutConfig.requestTimeoutMs).toBe(30000);
      expect(timeoutConfig.connectionTimeoutMs).toBe(10000);
    });
  });

  describe('Configuration Summary', () => {
    test('should provide configuration summary', () => {
      process.env.WHATSAPP_ACCESS_TOKEN = 'test-token-12345678901234567890123456789012345678901234567890';
      process.env.WHATSAPP_PHONE_NUMBER_ID = '1234567890123456';
      process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN = 'test-webhook-token-123';
      process.env.WHATSAPP_BUSINESS_ACCOUNT_ID = 'business-account-123';
      process.env.WHATSAPP_CLOUD_API_ENABLED = 'true';

      const config = new CloudApiConfigManager();
      const summary = config.getConfigSummary();
      
      expect(summary.enabled).toBe(true);
      expect(summary.apiVersion).toBe('v18.0');
      expect(summary.phoneNumberId).toBe('1234567890123456');
      expect(summary.hasAccessToken).toBe(true);
      expect(summary.hasWebhookToken).toBe(true);
      expect(summary.hasBusinessAccountId).toBe(true);
    });
  });
});