import { jest } from '@jest/globals';
import { ConfigManager } from '../../src/config/config.js';

// Mock environment variables
const mockEnv = {
  NODE_ENV: 'test',
  PORT: '3000',
  MONGO_URI: 'mongodb://test-uri',
  TWILIO_ACCOUNT_SID: 'test-sid',
  TWILIO_AUTH_TOKEN: 'test-token',
  TWILIO_PHONE_NUMBER: '+1234567890',
  OPENAI_API_KEY: 'test-openai-key',
  GOOGLE_CLIENT_ID: 'test-client-id',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'http://localhost:3000/callback',
  TOKEN_ENCRYPTION_KEY: 'test-encryption-key-32-characters-long',
  DEFAULT_TIMEZONE: 'America/Sao_Paulo',
  DEFAULT_EVENT_DURATION_MINUTES: '30',
  MAX_SYNC_RETRIES: '3',
  SYNC_RETRY_BASE_DELAY_MS: '1000',
  GOOGLE_CALENDAR_INTEGRATION_ENABLED: 'true',
  SYNC_RETRY_ENABLED: 'true',
  BACKGROUND_SYNC_ENABLED: 'true'
};

describe('ConfigManager', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = process.env;
    process.env = { ...mockEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Configuration Loading', () => {
    test('should load configuration successfully with valid environment', () => {
      const config = new ConfigManager();
      
      expect(config.get('nodeEnv')).toBe('test');
      expect(config.get('port')).toBe(3000);
      expect(config.get('mongoUri')).toBe('mongodb://test-uri');
      expect(config.get('google.clientId')).toBe('test-client-id');
      expect(config.get('googleCalendar.defaultTimezone')).toBe('America/Sao_Paulo');
    });

    test('should apply default values for optional configuration', () => {
      delete process.env.DEFAULT_TIMEZONE;
      delete process.env.DEFAULT_EVENT_DURATION_MINUTES;
      
      const config = new ConfigManager();
      
      expect(config.get('googleCalendar.defaultTimezone')).toBe('America/Sao_Paulo');
      expect(config.get('googleCalendar.defaultEventDurationMinutes')).toBe(30);
    });

    test('should parse numeric values correctly', () => {
      process.env.PORT = '8080';
      process.env.MAX_SYNC_RETRIES = '5';
      
      const config = new ConfigManager();
      
      expect(config.get('port')).toBe(8080);
      expect(config.get('googleCalendar.maxSyncRetries')).toBe(5);
    });
  });

  describe('Feature Flags', () => {
    test('should load feature flags with correct defaults', () => {
      const config = new ConfigManager();
      
      expect(config.isFeatureEnabled('googleCalendarIntegrationEnabled')).toBe(true);
      expect(config.isFeatureEnabled('syncRetryEnabled')).toBe(true);
      expect(config.isFeatureEnabled('enhancedLoggingEnabled')).toBe(false);
    });

    test('should parse boolean values correctly', () => {
      process.env.GOOGLE_CALENDAR_INTEGRATION_ENABLED = 'false';
      process.env.DEBUG_MODE_ENABLED = '1';
      process.env.ENHANCED_LOGGING_ENABLED = 'yes';
      
      const config = new ConfigManager();
      
      expect(config.isFeatureEnabled('googleCalendarIntegrationEnabled')).toBe(false);
      expect(config.isFeatureEnabled('debugModeEnabled')).toBe(true);
      expect(config.isFeatureEnabled('enhancedLoggingEnabled')).toBe(true);
    });

    test('should update feature flags at runtime', () => {
      const config = new ConfigManager();
      
      expect(config.isFeatureEnabled('debugModeEnabled')).toBe(false);
      
      config.updateFeatureFlag('debugModeEnabled', true);
      
      expect(config.isFeatureEnabled('debugModeEnabled')).toBe(true);
    });

    test('should throw error for unknown feature flag', () => {
      const config = new ConfigManager();
      
      expect(() => {
        config.updateFeatureFlag('unknownFlag', true);
      }).toThrow('Unknown feature flag: unknownFlag');
    });
  });

  describe('Configuration Validation', () => {
    test('should validate successfully with all required fields', () => {
      expect(() => new ConfigManager()).not.toThrow();
    });

    test('should fail validation with missing required fields', () => {
      delete process.env.MONGO_URI;
      
      expect(() => new ConfigManager()).toThrow('Configuration validation failed');
    });

    test('should validate Google Calendar requirements when enabled', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      process.env.GOOGLE_CALENDAR_INTEGRATION_ENABLED = 'true';
      
      expect(() => new ConfigManager()).toThrow('Configuration validation failed');
    });

    test('should skip Google Calendar validation when disabled', () => {
      delete process.env.GOOGLE_CLIENT_ID;
      process.env.GOOGLE_CALENDAR_INTEGRATION_ENABLED = 'false';
      
      expect(() => new ConfigManager()).not.toThrow();
    });

    test('should validate numeric ranges', () => {
      process.env.PORT = '99999';
      
      expect(() => new ConfigManager()).toThrow('Configuration validation failed');
    });

    test('should validate encryption key in production', () => {
      process.env.NODE_ENV = 'production';
      process.env.TOKEN_ENCRYPTION_KEY = 'short-key';
      
      expect(() => new ConfigManager()).toThrow('Configuration validation failed');
    });

    test('should validate timezone', () => {
      process.env.DEFAULT_TIMEZONE = 'Invalid/Timezone';
      
      expect(() => new ConfigManager()).toThrow('Configuration validation failed');
    });
  });

  describe('Configuration Access', () => {
    test('should get nested configuration values', () => {
      const config = new ConfigManager();
      
      expect(config.get('google.clientId')).toBe('test-client-id');
      expect(config.get('googleCalendar.defaultTimezone')).toBe('America/Sao_Paulo');
    });

    test('should return default value for missing configuration', () => {
      const config = new ConfigManager();
      
      expect(config.get('nonexistent.path', 'default')).toBe('default');
    });

    test('should return all feature flags', () => {
      const config = new ConfigManager();
      const flags = config.getFeatureFlags();
      
      expect(flags).toHaveProperty('googleCalendarIntegrationEnabled');
      expect(flags).toHaveProperty('syncRetryEnabled');
      expect(typeof flags.googleCalendarIntegrationEnabled).toBe('boolean');
    });

    test('should return sanitized configuration', () => {
      const config = new ConfigManager();
      const allConfig = config.getAllConfig();
      
      expect(allConfig.config.twilio.authToken).toBe('***');
      expect(allConfig.config.openai.apiKey).toBe('***');
      expect(allConfig.config.google.clientSecret).toBe('***');
      expect(allConfig.config.encryption.key).toBe('***');
    });
  });

  describe('Configuration Documentation', () => {
    test('should return configuration documentation', () => {
      const config = new ConfigManager();
      const docs = config.getConfigurationDocs();
      
      expect(docs).toHaveProperty('environmentVariables');
      expect(docs).toHaveProperty('featureFlags');
      expect(docs).toHaveProperty('examples');
      
      expect(docs.environmentVariables).toHaveProperty('required');
      expect(docs.environmentVariables).toHaveProperty('optional');
      expect(docs.featureFlags).toHaveProperty('GOOGLE_CALENDAR_INTEGRATION_ENABLED');
    });
  });

  describe('Boolean Parsing', () => {
    test('should parse various boolean representations', () => {
      const config = new ConfigManager();
      
      expect(config.parseBoolean('true')).toBe(true);
      expect(config.parseBoolean('TRUE')).toBe(true);
      expect(config.parseBoolean('1')).toBe(true);
      expect(config.parseBoolean('yes')).toBe(true);
      expect(config.parseBoolean('false')).toBe(false);
      expect(config.parseBoolean('FALSE')).toBe(false);
      expect(config.parseBoolean('0')).toBe(false);
      expect(config.parseBoolean('no')).toBe(false);
      expect(config.parseBoolean(undefined, true)).toBe(true);
      expect(config.parseBoolean(null, false)).toBe(false);
    });
  });
});