import { describe, test, expect, beforeAll, afterAll, beforeEach } from '@jest/globals';
import { CloudApiService } from '../../src/services/cloudApiService.js';
import cloudApiConfig from '../../src/config/cloudApiConfig.js';

describe('Cloud API Basic Integration Tests', () => {
  let cloudApiService;

  // Test configuration
  const testConfig = {
    WHATSAPP_CLOUD_API_ENABLED: 'true',
    WHATSAPP_ACCESS_TOKEN: 'test_access_token_123',
    WHATSAPP_PHONE_NUMBER_ID: '123456789',
    WHATSAPP_BUSINESS_ACCOUNT_ID: 'test_business_account',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test_verify_token_123',
    WHATSAPP_API_VERSION: 'v18.0',
    WHATSAPP_CLOUD_API_URL: 'https://graph.facebook.com'
  };

  beforeAll(() => {
    // Set up test environment variables
    Object.keys(testConfig).forEach(key => {
      process.env[key] = testConfig[key];
    });
    
    // Force reload of config module to pick up new environment variables
    delete require.cache[require.resolve('../../src/config/cloudApiConfig.js')];
  });

  afterAll(() => {
    // Clean up environment variables
    Object.keys(testConfig).forEach(key => {
      delete process.env[key];
    });
  });

  beforeEach(() => {
    // Ensure environment variables are set for each test
    Object.keys(testConfig).forEach(key => {
      process.env[key] = testConfig[key];
    });
    
    // Initialize Cloud API service for each test
    cloudApiService = new CloudApiService();
  });

  describe('Service Initialization', () => {
    test('should initialize CloudApiService successfully', () => {
      expect(cloudApiService).toBeDefined();
      expect(cloudApiService.config).toBeDefined();
      expect(cloudApiService.retryHandler).toBeDefined();
      expect(cloudApiService.errorHandler).toBeDefined();
    });

    test('should validate configuration on initialization', () => {
      expect(() => {
        new CloudApiService();
      }).not.toThrow();
    });

    test('should throw error for missing configuration', () => {
      const originalToken = process.env.WHATSAPP_ACCESS_TOKEN;
      delete process.env.WHATSAPP_ACCESS_TOKEN;

      expect(() => {
        new CloudApiService();
      }).toThrow('configuration is incomplete');

      process.env.WHATSAPP_ACCESS_TOKEN = originalToken;
    });
  });

  describe('Phone Number Formatting', () => {
    test('should format Brazilian phone numbers correctly', () => {
      const testCases = [
        { input: '11999999999', expected: '5511999999999' },
        { input: '+5511999999999', expected: '5511999999999' },
        { input: 'whatsapp:+5511999999999', expected: '5511999999999' },
        { input: '5511999999999', expected: '5511999999999' },
        { input: '21987654321', expected: '5521987654321' }
      ];

      testCases.forEach(({ input, expected }) => {
        const result = cloudApiService.formatPhoneNumber(input);
        expect(result).toBe(expected);
      });
    });

    test('should throw error for invalid phone numbers', () => {
      const invalidNumbers = ['', '123', 'invalid', null, undefined];

      invalidNumbers.forEach(number => {
        expect(() => {
          cloudApiService.formatPhoneNumber(number);
        }).toThrow();
      });
    });
  });

  describe('Message Content Validation', () => {
    test('should validate text message content', () => {
      const validMessages = [
        'Hello world',
        'This is a test message',
        'Message with numbers 123',
        'Message with emojis 😀🎉'
      ];

      validMessages.forEach(message => {
        expect(() => {
          cloudApiService.validateMessageContent(message, 'text');
        }).not.toThrow();
      });
    });

    test('should reject empty or null messages', () => {
      const invalidMessages = ['', null, undefined, '   '];

      invalidMessages.forEach(message => {
        expect(() => {
          cloudApiService.validateMessageContent(message, 'text');
        }).toThrow();
      });
    });

    test('should reject messages that are too long', () => {
      const longMessage = 'a'.repeat(5000); // Exceeds typical limits

      expect(() => {
        cloudApiService.validateMessageContent(longMessage, 'text');
      }).toThrow();
    });
  });

  describe('Media URL Validation', () => {
    test('should validate correct media URLs', () => {
      const validUrls = [
        'https://example.com/image.jpg',
        'https://example.com/document.pdf',
        'https://example.com/video.mp4',
        'https://example.com/audio.mp3',
        'http://example.com/file.png'
      ];

      validUrls.forEach(url => {
        expect(() => {
          cloudApiService.validateMediaUrl(url);
        }).not.toThrow();
      });
    });

    test('should reject invalid media URLs', () => {
      const invalidUrls = [
        'not_a_url',
        'ftp://example.com/file.txt',
        '',
        null,
        undefined,
        'javascript:alert("xss")'
      ];

      invalidUrls.forEach(url => {
        expect(() => {
          cloudApiService.validateMediaUrl(url);
        }).toThrow();
      });
    });
  });

  describe('Media Type Detection', () => {
    test('should detect media types from URLs correctly', () => {
      const testCases = [
        { url: 'https://example.com/image.jpg', expected: 'image' },
        { url: 'https://example.com/photo.jpeg', expected: 'image' },
        { url: 'https://example.com/picture.png', expected: 'image' },
        { url: 'https://example.com/video.mp4', expected: 'video' },
        { url: 'https://example.com/clip.mov', expected: 'video' },
        { url: 'https://example.com/audio.mp3', expected: 'audio' },
        { url: 'https://example.com/sound.wav', expected: 'audio' },
        { url: 'https://example.com/document.pdf', expected: 'document' },
        { url: 'https://example.com/file.docx', expected: 'document' },
        { url: 'https://example.com/unknown.xyz', expected: 'document' }
      ];

      testCases.forEach(({ url, expected }) => {
        const result = cloudApiService.detectMediaType(url);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Template Components Building', () => {
    test('should build template components correctly', () => {
      const variables = {
        body: ['John Doe', '100.50'],
        header: ['Invoice #123']
      };

      const components = cloudApiService.buildTemplateComponents(variables);

      expect(components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'John Doe' },
            { type: 'text', text: '100.50' }
          ]
        },
        {
          type: 'header',
          parameters: [
            { type: 'text', text: 'Invoice #123' }
          ]
        }
      ]);
    });

    test('should handle single parameter templates', () => {
      const variables = {
        body: 'Single parameter'
      };

      const components = cloudApiService.buildTemplateComponents(variables);

      expect(components).toEqual([
        {
          type: 'body',
          parameters: [
            { type: 'text', text: 'Single parameter' }
          ]
        }
      ]);
    });

    test('should handle empty variables', () => {
      const variables = {};
      const components = cloudApiService.buildTemplateComponents(variables);
      expect(components).toEqual([]);
    });

    test('should handle button parameters', () => {
      const variables = {
        buttons: [
          { type: 'quick_reply', text: 'Yes', payload: 'yes' },
          { type: 'quick_reply', text: 'No', payload: 'no' }
        ]
      };

      const components = cloudApiService.buildTemplateComponents(variables);

      expect(components).toHaveLength(2);
      expect(components[0]).toMatchObject({
        type: 'button',
        sub_type: 'quick_reply',
        index: 0,
        parameters: [{ type: 'payload', payload: 'yes' }]
      });
    });
  });

  describe('Parameter Type Detection', () => {
    test('should detect parameter types correctly', () => {
      const testCases = [
        { value: 'Hello', expected: 'text' },
        { value: 123, expected: 'text' },
        { value: '2024-01-15', expected: 'date_time' },
        { value: 'https://example.com/image.jpg', expected: 'document' },
        { value: 'https://example.com/file.pdf', expected: 'document' },
        { value: true, expected: 'text' }
      ];

      testCases.forEach(({ value, expected }) => {
        const result = cloudApiService.getParameterType(value);
        expect(result).toBe(expected);
      });
    });
  });

  describe('Request ID Generation', () => {
    test('should generate unique request IDs', () => {
      const id1 = cloudApiService.generateRequestId();
      const id2 = cloudApiService.generateRequestId();

      expect(id1).toBeDefined();
      expect(id2).toBeDefined();
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^req_\d+_[a-z0-9]+$/);
    });
  });

  describe('Media Type Specifications', () => {
    test('should return correct media type specifications', () => {
      const specs = cloudApiService.getMediaTypeSpecs();

      expect(specs).toHaveProperty('image');
      expect(specs).toHaveProperty('video');
      expect(specs).toHaveProperty('audio');
      expect(specs).toHaveProperty('document');

      expect(specs.image).toMatchObject({
        maxSize: '5MB',
        supportedFormats: expect.arrayContaining(['JPEG', 'PNG']),
        supportsCaption: true
      });

      expect(specs.video).toMatchObject({
        maxSize: '16MB',
        supportedFormats: expect.arrayContaining(['MP4', '3GPP']),
        supportsCaption: true
      });

      expect(specs.audio).toMatchObject({
        maxSize: '16MB',
        supportedFormats: expect.arrayContaining(['MP3', 'WAV']),
        supportsCaption: false
      });

      expect(specs.document).toMatchObject({
        maxSize: '100MB',
        supportedFormats: expect.arrayContaining(['PDF', 'DOC']),
        supportsCaption: true
      });
    });
  });

  describe('Configuration Access', () => {
    test('should access configuration correctly', () => {
      const config = cloudApiService.config.getConfig();

      expect(config).toMatchObject({
        accessToken: testConfig.WHATSAPP_ACCESS_TOKEN,
        phoneNumberId: testConfig.WHATSAPP_PHONE_NUMBER_ID,
        businessAccountId: testConfig.WHATSAPP_BUSINESS_ACCOUNT_ID,
        apiVersion: testConfig.WHATSAPP_API_VERSION
      });
    });

    test('should check if service is enabled', () => {
      const isEnabled = cloudApiService.config.isEnabled();
      expect(isEnabled).toBe(true);
    });

    test('should get API URL correctly', () => {
      const url = cloudApiService.config.getApiUrl('messages');
      expect(url).toContain(testConfig.WHATSAPP_CLOUD_API_URL);
      expect(url).toContain(testConfig.WHATSAPP_PHONE_NUMBER_ID);
      expect(url).toContain('messages');
    });

    test('should get request headers correctly', () => {
      const headers = cloudApiService.config.getRequestHeaders();
      
      expect(headers).toMatchObject({
        'Authorization': `Bearer ${testConfig.WHATSAPP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json'
      });
    });
  });

  describe('Service Health Status', () => {
    test('should return health status structure', async () => {
      // Mock the connectivity test to avoid actual API calls
      const originalTestConnectivity = cloudApiService.config.testConnectivity;
      cloudApiService.config.testConnectivity = jest.fn().mockResolvedValue({
        success: true,
        responseTime: 100
      });

      const healthStatus = await cloudApiService.getHealthStatus();

      expect(healthStatus).toMatchObject({
        service: 'CloudApiService',
        status: expect.stringMatching(/^(healthy|unhealthy)$/),
        enabled: expect.any(Boolean),
        lastCheck: expect.any(String)
      });

      // Restore original method
      cloudApiService.config.testConnectivity = originalTestConnectivity;
    });
  });

  describe('Error Handling Setup', () => {
    test('should have error handler configured', () => {
      expect(cloudApiService.errorHandler).toBeDefined();
      expect(typeof cloudApiService.errorHandler.handleError).toBe('function');
    });

    test('should have retry handler configured', () => {
      expect(cloudApiService.retryHandler).toBeDefined();
      expect(typeof cloudApiService.retryHandler.executeWithRetry).toBe('function');
      expect(cloudApiService.retryHandler.isHealthy()).toBe(true);
    });

    test('should have metrics collector configured', () => {
      expect(cloudApiService.metricsCollector).toBeDefined();
      expect(typeof cloudApiService.metricsCollector.recordRequest).toBe('function');
      expect(typeof cloudApiService.metricsCollector.recordMessage).toBe('function');
    });
  });
});