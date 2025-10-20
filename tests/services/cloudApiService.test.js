import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

// Mock dependencies before importing
jest.mock('axios', () => ({
  __esModule: true,
  default: jest.fn()
}));

// Create a mock config object
const mockCloudApiConfig = {
  isEnabled: jest.fn(() => true),
  isMigrationMode: jest.fn(() => false),
  getConfig: jest.fn(() => ({
    accessToken: 'test-access-token',
    phoneNumberId: '1234567890',
    apiVersion: 'v18.0'
  })),
  getApiUrl: jest.fn((endpoint) => `https://graph.facebook.com/v18.0/1234567890/${endpoint || ''}`),
  getRequestHeaders: jest.fn(() => ({
    'Authorization': 'Bearer test-access-token',
    'Content-Type': 'application/json',
    'User-Agent': 'WhatsApp-Cloud-API-Client/1.0'
  })),
  getRetryConfig: jest.fn(() => ({
    maxRetries: 3,
    baseDelayMs: 1000,
    maxDelayMs: 30000,
    backoffMultiplier: 2,
    jitterFactor: 0.1
  })),
  getTimeoutConfig: jest.fn(() => ({
    requestTimeoutMs: 30000,
    connectionTimeoutMs: 10000
  })),
  validateMessageContent: jest.fn(() => true),
  testConnectivity: jest.fn(() => Promise.resolve({ success: true, status: 200 })),
  getConfigSummary: jest.fn(() => ({ enabled: true, migrationMode: false }))
};

jest.mock('../../src/config/cloudApiConfig.js', () => ({
  default: mockCloudApiConfig
}));

const mockStructuredLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn()
};

jest.mock('../../src/helpers/logger.js', () => ({
  structuredLogger: mockStructuredLogger
}));

// Import modules after mocking
import axios from 'axios';
import { CloudApiService } from '../../src/services/cloudApiService.js';
import { CloudApiError } from '../../src/services/errorHandling/CloudApiErrorHandler.js';

const mockAxios = axios;

describe('CloudApiService', () => {
  let service;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations
    mockCloudApiConfig.isEnabled.mockReturnValue(true);
    mockCloudApiConfig.isMigrationMode.mockReturnValue(false);
    mockCloudApiConfig.getConfig.mockReturnValue({
      accessToken: 'test-access-token',
      phoneNumberId: '1234567890',
      apiVersion: 'v18.0'
    });
    mockCloudApiConfig.validateMessageContent.mockReturnValue(true);
    service = new CloudApiService(mockCloudApiConfig);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Constructor and Initialization', () => {
    it('should initialize successfully with valid configuration', () => {
      expect(service).toBeInstanceOf(CloudApiService);
      expect(mockCloudApiConfig.isEnabled).toHaveBeenCalled();
      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        'CloudApiService initialized',
        expect.objectContaining({
          apiVersion: 'v18.0',
          phoneNumberId: '1234567890',
          enabled: true
        })
      );
    });

    it('should throw error when Cloud API is not enabled', () => {
      const disabledConfig = {
        ...mockCloudApiConfig,
        isEnabled: jest.fn(() => false),
        isMigrationMode: jest.fn(() => false)
      };

      expect(() => new CloudApiService(disabledConfig)).toThrow(
        'WhatsApp Cloud API is not enabled. Check WHATSAPP_CLOUD_API_ENABLED or WHATSAPP_CLOUD_API_MIGRATION_MODE environment variables.'
      );
    });

    it('should initialize successfully in migration mode', () => {
      const migrationConfig = {
        ...mockCloudApiConfig,
        isEnabled: jest.fn(() => false),
        isMigrationMode: jest.fn(() => true)
      };

      expect(() => new CloudApiService(migrationConfig)).not.toThrow();
    });

    it('should throw error when configuration is incomplete', () => {
      const incompleteConfig = {
        ...mockCloudApiConfig,
        getConfig: jest.fn(() => ({
          accessToken: '',
          phoneNumberId: '1234567890'
        }))
      };

      expect(() => new CloudApiService(incompleteConfig)).toThrow(
        'WhatsApp Cloud API configuration is incomplete. Missing access token or phone number ID.'
      );
    });
  });

  describe('Phone Number Formatting', () => {
    it('should format Brazilian phone number correctly', () => {
      const testCases = [
        { input: '11987654321', expected: '5511987654321' },
        { input: '+5511987654321', expected: '5511987654321' },
        { input: '5511987654321', expected: '5511987654321' },
        { input: 'whatsapp:+5511987654321', expected: '5511987654321' },
        { input: '1234567890', expected: '55111234567890' }, // Add default area code
        { input: '21987654321', expected: '5521987654321' }, // Rio area code
      ];

      testCases.forEach(({ input, expected }) => {
        expect(service.formatPhoneNumber(input)).toBe(expected);
      });
    });

    it('should throw error for invalid phone numbers', () => {
      const invalidNumbers = ['', null, undefined, '123', '12345678901234567890'];

      invalidNumbers.forEach(number => {
        expect(() => service.formatPhoneNumber(number)).toThrow();
      });
    });

    it('should warn for unusual Brazilian phone number lengths', () => {
      service.formatPhoneNumber('551198765432'); // 12 digits instead of 13
      
      expect(mockStructuredLogger.warn).toHaveBeenCalledWith(
        'Unusual Brazilian phone number length',
        expect.objectContaining({
          originalNumber: '551198765432',
          formattedNumber: '551198765432',
          length: 12
        })
      );
    });
  });

  describe('sendTextMessage', () => {
    const mockSuccessResponse = {
      data: {
        messaging_product: 'whatsapp',
        messages: [
          {
            id: 'wamid.test123',
            message_status: 'sent'
          }
        ]
      },
      status: 200
    };

    beforeEach(() => {
      mockAxios.mockResolvedValue(mockSuccessResponse);
    });

    it('should send text message successfully', async () => {
      const to = '11987654321';
      const body = 'Hello, this is a test message!';

      const result = await service.sendTextMessage(to, body);

      expect(mockAxios).toHaveBeenCalledWith({
        method: 'POST',
        url: 'https://graph.facebook.com/v18.0/1234567890/messages',
        headers: {
          'Authorization': 'Bearer test-access-token',
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Cloud-API-Client/1.0'
        },
        timeout: 30000,
        validateStatus: expect.any(Function),
        data: {
          messaging_product: 'whatsapp',
          to: '5511987654321',
          type: 'text',
          text: {
            body: body
          }
        }
      });

      expect(result).toEqual({
        messageId: 'wamid.test123',
        status: 'sent',
        timestamp: expect.any(String),
        provider: 'cloud-api',
        to: '5511987654321',
        type: 'text',
        duration: expect.any(Number),
        requestId: expect.any(String),
        rawResponse: mockSuccessResponse.data
      });

      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        'Sending text message',
        expect.objectContaining({
          to: '5511987654321',
          messageLength: body.length,
          originalNumber: to
        })
      );

      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        'Text message sent successfully',
        expect.objectContaining({
          messageId: 'wamid.test123',
          to: '5511987654321',
          status: 'sent'
        })
      );
    });

    it('should throw error for missing recipient', async () => {
      await expect(service.sendTextMessage('', 'Hello')).rejects.toThrow(
        'Recipient phone number and message body are required'
      );

      await expect(service.sendTextMessage(null, 'Hello')).rejects.toThrow(
        'Recipient phone number and message body are required'
      );
    });

    it('should throw error for missing message body', async () => {
      await expect(service.sendTextMessage('11987654321', '')).rejects.toThrow(
        'Recipient phone number and message body are required'
      );

      await expect(service.sendTextMessage('11987654321', null)).rejects.toThrow(
        'Recipient phone number and message body are required'
      );
    });

    it('should validate message content', async () => {
      mockCloudApiConfig.validateMessageContent.mockImplementation(() => {
        throw new Error('Message content exceeds limit');
      });

      await expect(service.sendTextMessage('11987654321', 'Long message')).rejects.toThrow(
        'Message content exceeds limit'
      );

      expect(mockCloudApiConfig.validateMessageContent).toHaveBeenCalledWith('Long message', 'text');
    });

    it('should handle API error responses', async () => {
      const errorResponse = {
        response: {
          status: 400,
          data: {
            error: {
              message: 'Invalid phone number',
              code: 100,
              fbtrace_id: 'trace123'
            }
          }
        }
      };

      mockAxios.mockRejectedValue(errorResponse);

      await expect(service.sendTextMessage('invalid', 'Hello')).rejects.toThrow(CloudApiError);

      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        'Failed to send text message',
        expect.objectContaining({
          error: 'Invalid phone number',
          status: 400,
          code: 100
        })
      );
    });

    it('should handle network errors', async () => {
      const networkError = {
        request: {},
        message: 'Network Error'
      };

      mockAxios.mockRejectedValue(networkError);

      await expect(service.sendTextMessage('11987654321', 'Hello')).rejects.toThrow(
        'Network error: Network Error'
      );

      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        'Cloud API network error',
        expect.objectContaining({
          error: 'Network Error'
        })
      );
    });

    it('should retry on retryable errors', async () => {
      const retryableError = {
        response: {
          status: 429,
          data: {
            error: {
              message: 'Rate limit exceeded',
              code: 4,
              fbtrace_id: 'trace123'
            }
          }
        }
      };

      // First call fails, second succeeds
      mockAxios
        .mockRejectedValueOnce(retryableError)
        .mockResolvedValueOnce(mockSuccessResponse);

      const result = await service.sendTextMessage('11987654321', 'Hello');

      expect(mockAxios).toHaveBeenCalledTimes(2);
      expect(result.messageId).toBe('wamid.test123');
      expect(mockStructuredLogger.warn).toHaveBeenCalledWith(
        'Cloud API request failed, retrying',
        expect.objectContaining({
          attempt: 1,
          maxRetries: 3,
          retryable: true
        })
      );
    });

    it('should not retry on non-retryable errors', async () => {
      const nonRetryableError = {
        response: {
          status: 400,
          data: {
            error: {
              message: 'Invalid request',
              code: 100
            }
          }
        }
      };

      mockAxios.mockRejectedValue(nonRetryableError);

      await expect(service.sendTextMessage('11987654321', 'Hello')).rejects.toThrow(CloudApiError);

      expect(mockAxios).toHaveBeenCalledTimes(1); // No retry
    });

    it('should format phone number from Twilio format', async () => {
      const twilioFormat = 'whatsapp:+5511987654321';
      
      await service.sendTextMessage(twilioFormat, 'Hello');

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            to: '5511987654321'
          })
        })
      );
    });

    it('should generate unique request IDs', async () => {
      await service.sendTextMessage('11987654321', 'Hello 1');
      await service.sendTextMessage('11987654321', 'Hello 2');

      const calls = mockStructuredLogger.info.mock.calls.filter(
        call => call[0] === 'Sending text message'
      );

      expect(calls).toHaveLength(2);
      expect(calls[0][1].requestId).not.toBe(calls[1][1].requestId);
    });
  });

  describe('sendTemplateMessage', () => {
    const mockTemplateSuccessResponse = {
      data: {
        messaging_product: 'whatsapp',
        messages: [
          {
            id: 'wamid.template123',
            message_status: 'sent'
          }
        ]
      },
      status: 200
    };

    beforeEach(() => {
      mockAxios.mockResolvedValue(mockTemplateSuccessResponse);
    });

    it('should send template message successfully with body variables', async () => {
      const to = '11987654321';
      const templateName = 'reminder_template';
      const variables = {
        body: ['João', '2025-12-25', 'R$ 150,00']
      };

      const result = await service.sendTemplateMessage(to, templateName, variables);

      expect(mockAxios).toHaveBeenCalledWith({
        method: 'POST',
        url: 'https://graph.facebook.com/v18.0/1234567890/messages',
        headers: {
          'Authorization': 'Bearer test-access-token',
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Cloud-API-Client/1.0'
        },
        timeout: 30000,
        validateStatus: expect.any(Function),
        data: {
          messaging_product: 'whatsapp',
          to: '5511987654321',
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: 'pt_BR'
            },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: 'João' },
                  { type: 'text', text: '2025-12-25' },
                  { type: 'text', text: 'R$ 150,00' }
                ]
              }
            ]
          }
        }
      });

      expect(result).toEqual({
        messageId: 'wamid.template123',
        status: 'sent',
        timestamp: expect.any(String),
        provider: 'cloud-api',
        to: '5511987654321',
        type: 'template',
        templateName,
        languageCode: 'pt_BR',
        duration: expect.any(Number),
        requestId: expect.any(String),
        rawResponse: mockTemplateSuccessResponse.data
      });
    });

    it('should send template message with custom language code', async () => {
      const to = '11987654321';
      const templateName = 'welcome_template';
      const variables = { body: 'Welcome!' };
      const languageCode = 'en_US';

      await service.sendTemplateMessage(to, templateName, variables, languageCode);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            template: expect.objectContaining({
              language: { code: 'en_US' }
            })
          })
        })
      );
    });

    it('should handle header and body parameters', async () => {
      const to = '11987654321';
      const templateName = 'complex_template';
      const variables = {
        header: 'Important Notice',
        body: ['João', 'tomorrow', '10:00 AM']
      };

      await service.sendTemplateMessage(to, templateName, variables);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            template: expect.objectContaining({
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: 'João' },
                    { type: 'text', text: 'tomorrow' },
                    { type: 'text', text: '10:00 AM' }
                  ]
                },
                {
                  type: 'header',
                  parameters: [
                    { type: 'text', text: 'Important Notice' }
                  ]
                }
              ]
            })
          })
        })
      );
    });

    it('should handle button parameters', async () => {
      const to = '11987654321';
      const templateName = 'interactive_template';
      const variables = {
        body: ['Select an option'],
        buttons: [
          { type: 'quick_reply', text: 'Yes', payload: 'yes' },
          { type: 'quick_reply', text: 'No', payload: 'no' }
        ]
      };

      await service.sendTemplateMessage(to, templateName, variables);

      const expectedComponents = [
        {
          type: 'body',
          parameters: [{ type: 'text', text: 'Select an option' }]
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: 0,
          parameters: [{ type: 'payload', payload: 'yes' }]
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: 1,
          parameters: [{ type: 'payload', payload: 'no' }]
        }
      ];

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            template: expect.objectContaining({
              components: expectedComponents
            })
          })
        })
      );
    });

    it('should convert object variables to body parameters', async () => {
      const to = '11987654321';
      const templateName = 'simple_template';
      const variables = {
        name: 'João',
        amount: 150.50,
        date: '2025-12-25'
      };

      await service.sendTemplateMessage(to, templateName, variables);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            template: expect.objectContaining({
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: 'João' },
                    { type: 'text', text: '150.5' },
                    { type: 'text', text: '2025-12-25' }
                  ]
                }
              ]
            })
          })
        })
      );
    });

    it('should throw error for missing recipient', async () => {
      await expect(service.sendTemplateMessage('', 'template')).rejects.toThrow(
        'Recipient phone number and template name are required'
      );

      await expect(service.sendTemplateMessage(null, 'template')).rejects.toThrow(
        'Recipient phone number and template name are required'
      );
    });

    it('should throw error for missing template name', async () => {
      await expect(service.sendTemplateMessage('11987654321', '')).rejects.toThrow(
        'Recipient phone number and template name are required'
      );

      await expect(service.sendTemplateMessage('11987654321', null)).rejects.toThrow(
        'Recipient phone number and template name are required'
      );
    });

    it('should handle template API errors', async () => {
      const templateError = {
        response: {
          status: 400,
          data: {
            error: {
              message: 'Template not approved',
              code: 132000,
              fbtrace_id: 'template_trace123'
            }
          }
        }
      };

      mockAxios.mockRejectedValue(templateError);

      await expect(service.sendTemplateMessage('11987654321', 'invalid_template')).rejects.toThrow(CloudApiError);

      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        'Failed to send template message',
        expect.objectContaining({
          templateName: 'invalid_template',
          error: 'Template not approved',
          status: 400,
          code: 132000
        })
      );
    });

    it('should send template with empty variables', async () => {
      const to = '11987654321';
      const templateName = 'no_vars_template';

      await service.sendTemplateMessage(to, templateName);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            template: expect.objectContaining({
              components: []
            })
          })
        })
      );
    });

    it('should detect parameter types correctly', async () => {
      const to = '11987654321';
      const templateName = 'typed_template';
      const variables = {
        body: [
          'text_param',
          123,
          '2025-12-25T10:00:00Z',
          'https://example.com/document.pdf'
        ]
      };

      await service.sendTemplateMessage(to, templateName, variables);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            template: expect.objectContaining({
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: 'text_param' },
                    { type: 'text', text: '123' },
                    { type: 'date_time', text: '2025-12-25T10:00:00Z' },
                    { type: 'document', text: 'https://example.com/document.pdf' }
                  ]
                }
              ]
            })
          })
        })
      );
    });
  });

  describe('sendMediaMessage', () => {
    const mockMediaSuccessResponse = {
      data: {
        messaging_product: 'whatsapp',
        messages: [
          {
            id: 'wamid.media123',
            message_status: 'sent'
          }
        ]
      },
      status: 200
    };

    beforeEach(() => {
      mockAxios.mockResolvedValue(mockMediaSuccessResponse);
    });

    it('should send image message successfully', async () => {
      const to = '11987654321';
      const mediaUrl = 'https://example.com/image.jpg';
      const caption = 'Check out this image!';

      const result = await service.sendMediaMessage(to, mediaUrl, caption);

      expect(mockAxios).toHaveBeenCalledWith({
        method: 'POST',
        url: 'https://graph.facebook.com/v18.0/1234567890/messages',
        headers: {
          'Authorization': 'Bearer test-access-token',
          'Content-Type': 'application/json',
          'User-Agent': 'WhatsApp-Cloud-API-Client/1.0'
        },
        timeout: 30000,
        validateStatus: expect.any(Function),
        data: {
          messaging_product: 'whatsapp',
          to: '5511987654321',
          type: 'image',
          image: {
            link: mediaUrl,
            caption: caption
          }
        }
      });

      expect(result).toEqual({
        messageId: 'wamid.media123',
        status: 'sent',
        timestamp: expect.any(String),
        provider: 'cloud-api',
        to: '5511987654321',
        type: 'media',
        mediaType: 'image',
        mediaUrl,
        caption,
        duration: expect.any(Number),
        requestId: expect.any(String),
        rawResponse: mockMediaSuccessResponse.data
      });
    });

    it('should send document message successfully', async () => {
      const to = '11987654321';
      const mediaUrl = 'https://example.com/document.pdf';
      const caption = 'Important document';

      await service.sendMediaMessage(to, mediaUrl, caption, 'document');

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: {
            messaging_product: 'whatsapp',
            to: '5511987654321',
            type: 'document',
            document: {
              link: mediaUrl,
              caption: caption
            }
          }
        })
      );
    });

    it('should auto-detect media type from URL', async () => {
      const testCases = [
        { url: 'https://example.com/photo.png', expectedType: 'image' },
        { url: 'https://example.com/video.mp4', expectedType: 'video' },
        { url: 'https://example.com/song.mp3', expectedType: 'audio' },
        { url: 'https://example.com/file.pdf', expectedType: 'document' }
      ];

      for (const testCase of testCases) {
        mockAxios.mockClear();
        await service.sendMediaMessage('11987654321', testCase.url);
        
        expect(mockAxios).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({
              type: testCase.expectedType,
              [testCase.expectedType]: expect.objectContaining({
                link: testCase.url
              })
            })
          })
        );
      }
    });

    it('should throw error for missing recipient or media URL', async () => {
      await expect(service.sendMediaMessage('', 'https://example.com/image.jpg')).rejects.toThrow(
        'Recipient phone number and media URL are required'
      );

      await expect(service.sendMediaMessage('11987654321', '')).rejects.toThrow(
        'Recipient phone number and media URL are required'
      );
    });

    it('should validate media URL format', async () => {
      await expect(service.sendMediaMessage('11987654321', 'not-a-url')).rejects.toThrow(
        /Invalid media URL format/
      );
    });

    it('should handle media API errors', async () => {
      const mediaError = {
        response: {
          status: 400,
          data: {
            error: {
              message: 'Media file too large',
              code: 131026,
              fbtrace_id: 'media_trace123'
            }
          }
        }
      };

      mockAxios.mockRejectedValue(mediaError);

      await expect(service.sendMediaMessage('11987654321', 'https://example.com/large-file.jpg'))
        .rejects.toThrow(CloudApiError);
    });
  });

  describe('Media Type Detection', () => {
    it('should detect media types correctly', () => {
      const testCases = [
        { url: 'https://example.com/photo.jpg', expected: 'image' },
        { url: 'https://example.com/video.mp4', expected: 'video' },
        { url: 'https://example.com/audio.mp3', expected: 'audio' },
        { url: 'https://example.com/doc.pdf', expected: 'document' },
        { url: 'https://example.com/unknown', expected: 'document' }
      ];

      testCases.forEach(({ url, expected }) => {
        expect(service.detectMediaType(url)).toBe(expected);
      });
    });

    it('should validate media URLs correctly', () => {
      const validUrls = [
        'https://example.com/image.jpg',
        'http://example.com/document.pdf'
      ];

      validUrls.forEach(url => {
        expect(() => service.validateMediaUrl(url)).not.toThrow();
      });
    });

    it('should return media type specifications', () => {
      const specs = service.getMediaTypeSpecs();
      
      expect(specs).toHaveProperty('image');
      expect(specs).toHaveProperty('video');
      expect(specs).toHaveProperty('audio');
      expect(specs).toHaveProperty('document');
      
      expect(specs.image).toHaveProperty('supportsCaption', true);
      expect(specs.audio).toHaveProperty('supportsCaption', false);
    });
  });

  describe('Media Download and Processing', () => {
    const mockMediaInfoResponse = {
      data: {
        url: 'https://example.com/media/download/123',
        mime_type: 'image/jpeg',
        file_size: 1024000,
        id: 'media123'
      },
      status: 200
    };

    const mockMediaContent = Buffer.from('fake-image-data');

    beforeEach(() => {
      mockAxios.mockResolvedValue(mockMediaInfoResponse);
    });

    it('should download media successfully', async () => {
      // Mock the media content download
      mockAxios
        .mockResolvedValueOnce(mockMediaInfoResponse) // getMediaInfo call
        .mockResolvedValueOnce({ data: mockMediaContent }); // downloadMediaContent call

      const result = await service.downloadMedia('media123');

      expect(result).toEqual({
        id: 'media123',
        url: 'https://example.com/media/download/123',
        mimeType: 'image/jpeg',
        fileSize: 1024000,
        content: mockMediaContent,
        downloadedAt: expect.any(String)
      });

      expect(mockAxios).toHaveBeenCalledTimes(2);
      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        'Media downloaded successfully',
        expect.objectContaining({
          mediaId: 'media123',
          mimeType: 'image/jpeg',
          fileSize: 1024000
        })
      );
    });

    it('should handle media download errors', async () => {
      const mediaError = {
        response: {
          status: 404,
          data: {
            error: {
              message: 'Media not found',
              code: 131009
            }
          }
        }
      };

      mockAxios.mockRejectedValue(mediaError);

      await expect(service.downloadMedia('invalid-media-id')).rejects.toThrow();

      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        'Failed to download media',
        expect.objectContaining({
          mediaId: 'invalid-media-id',
          error: 'Media not found'
        })
      );
    });

    it('should validate media content', () => {
      const validImageContent = Buffer.from('fake-image-data');
      const validation = service.validateMediaContent(validImageContent, 'image/jpeg');

      expect(validation.isValid).toBe(true);
      expect(validation.metadata.type).toBe('image');
      expect(validation.metadata.size).toBe(validImageContent.length);
    });

    it('should reject oversized media', () => {
      const oversizedContent = Buffer.alloc(6 * 1024 * 1024); // 6MB > 5MB limit for images
      const validation = service.validateMediaContent(oversizedContent, 'image/jpeg');

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain(expect.stringContaining('exceeds maximum'));
    });

    it('should reject unsupported MIME types', () => {
      const content = Buffer.from('fake-data');
      const validation = service.validateMediaContent(content, 'application/exe');

      expect(validation.isValid).toBe(false);
      expect(validation.errors).toContain(expect.stringContaining('not supported'));
    });

    it('should get media type from MIME type', () => {
      expect(service.getMediaTypeFromMime('image/jpeg')).toBe('image');
      expect(service.getMediaTypeFromMime('audio/mp3')).toBe('audio');
      expect(service.getMediaTypeFromMime('video/mp4')).toBe('video');
      expect(service.getMediaTypeFromMime('application/pdf')).toBe('document');
    });

    it('should return allowed MIME types', () => {
      const allowedTypes = service.getAllowedMimeTypes();
      
      expect(allowedTypes).toContain('image/jpeg');
      expect(allowedTypes).toContain('audio/mp3');
      expect(allowedTypes).toContain('video/mp4');
      expect(allowedTypes).toContain('application/pdf');
    });

    it('should process media for compatibility', async () => {
      mockAxios
        .mockResolvedValueOnce(mockMediaInfoResponse)
        .mockResolvedValueOnce({ data: mockMediaContent });

      const result = await service.processMediaForCompatibility('media123');

      expect(result).toBe('https://example.com/media/download/123');
      expect(mockStructuredLogger.info).toHaveBeenCalledWith(
        'Media processed for compatibility',
        expect.objectContaining({
          mediaId: 'media123',
          mimeType: 'image/jpeg'
        })
      );
    });
  });

  describe('Edge Cases and Error Scenarios', () => {
    it('should handle malformed API responses', async () => {
      const malformedResponse = {
        data: {
          // Missing messages array
          messaging_product: 'whatsapp'
        },
        status: 200
      };

      mockAxios.mockResolvedValue(malformedResponse);

      const result = await service.sendTextMessage('11987654321', 'Hello');

      expect(result.messageId).toBeUndefined();
      expect(result.status).toBe('sent'); // Default status
    });

    it('should handle network timeouts', async () => {
      const timeoutError = {
        code: 'ECONNABORTED',
        message: 'timeout of 30000ms exceeded'
      };

      mockAxios.mockRejectedValue(timeoutError);

      await expect(service.sendTextMessage('11987654321', 'Hello')).rejects.toThrow();

      expect(mockStructuredLogger.error).toHaveBeenCalledWith(
        'Cloud API network error',
        expect.objectContaining({
          error: 'timeout of 30000ms exceeded'
        })
      );
    });

    it('should handle concurrent requests', async () => {
      const mockResponse = {
        data: {
          messages: [{ id: 'msg_concurrent', message_status: 'sent' }]
        },
        status: 200
      };

      mockAxios.mockResolvedValue(mockResponse);

      const promises = Array.from({ length: 5 }, (_, i) => 
        service.sendTextMessage('11987654321', `Message ${i}`)
      );

      const results = await Promise.all(promises);

      expect(results).toHaveLength(5);
      results.forEach((result, i) => {
        expect(result.messageId).toBe('msg_concurrent');
        expect(result.requestId).toBeDefined();
      });

      // Each request should have unique request IDs
      const requestIds = results.map(r => r.requestId);
      const uniqueIds = new Set(requestIds);
      expect(uniqueIds.size).toBe(5);
    });

    it('should handle very long messages', async () => {
      const longMessage = 'A'.repeat(5000); // Very long message
      
      mockCloudApiConfig.validateMessageContent.mockImplementation(() => {
        throw new Error('Message exceeds 4096 character limit');
      });

      await expect(service.sendTextMessage('11987654321', longMessage))
        .rejects.toThrow('Message exceeds 4096 character limit');
    });

    it('should handle special characters in phone numbers', async () => {
      const specialNumbers = [
        '+55 (11) 9 8765-4321',
        '55 11 98765-4321',
        '(11) 98765-4321',
        '11-98765-4321'
      ];

      const mockResponse = {
        data: { messages: [{ id: 'msg_special', message_status: 'sent' }] },
        status: 200
      };
      mockAxios.mockResolvedValue(mockResponse);

      for (const number of specialNumbers) {
        const result = await service.sendTextMessage(number, 'Hello');
        expect(result.to).toBe('5511987654321');
      }
    });

    it('should handle empty template variables gracefully', async () => {
      const mockResponse = {
        data: { messages: [{ id: 'msg_empty', message_status: 'sent' }] },
        status: 200
      };
      mockAxios.mockResolvedValue(mockResponse);

      await service.sendTemplateMessage('11987654321', 'simple_template', {});

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            template: expect.objectContaining({
              components: []
            })
          })
        })
      );
    });

    it('should handle null/undefined template variables', async () => {
      const mockResponse = {
        data: { messages: [{ id: 'msg_null', message_status: 'sent' }] },
        status: 200
      };
      mockAxios.mockResolvedValue(mockResponse);

      const variables = {
        body: [null, undefined, '', 'valid']
      };

      await service.sendTemplateMessage('11987654321', 'template', variables);

      expect(mockAxios).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            template: expect.objectContaining({
              components: [
                {
                  type: 'body',
                  parameters: [
                    { type: 'text', text: 'null' },
                    { type: 'text', text: 'undefined' },
                    { type: 'text', text: '' },
                    { type: 'text', text: 'valid' }
                  ]
                }
              ]
            })
          })
        })
      );
    });
  });

  describe('Performance and Load Testing Scenarios', () => {
    it('should handle rapid sequential requests', async () => {
      const mockResponse = {
        data: { messages: [{ id: 'msg_rapid', message_status: 'sent' }] },
        status: 200
      };
      mockAxios.mockResolvedValue(mockResponse);

      const startTime = Date.now();
      const promises = [];

      for (let i = 0; i < 10; i++) {
        promises.push(service.sendTextMessage('11987654321', `Rapid message ${i}`));
      }

      const results = await Promise.all(promises);
      const endTime = Date.now();

      expect(results).toHaveLength(10);
      expect(endTime - startTime).toBeLessThan(5000); // Should complete within 5 seconds

      // Verify all requests have unique IDs
      const requestIds = results.map(r => r.requestId);
      expect(new Set(requestIds).size).toBe(10);
    });

    it('should track request durations', async () => {
      const mockResponse = {
        data: { messages: [{ id: 'msg_duration', message_status: 'sent' }] },
        status: 200
      };

      // Add artificial delay
      mockAxios.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(mockResponse), 100))
      );

      const result = await service.sendTextMessage('11987654321', 'Duration test');

      expect(result.duration).toBeGreaterThan(90); // At least 90ms due to delay
      expect(result.duration).toBeLessThan(1000); // But reasonable upper bound
    });
  });

  describe('Utility Methods', () => {
    it('should generate unique request IDs', () => {
      const id1 = service.generateRequestId();
      const id2 = service.generateRequestId();

      expect(id1).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^req_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });

    it('should validate message content', () => {
      expect(() => service.validateMessageContent('Hello', 'text')).not.toThrow();
      expect(mockCloudApiConfig.validateMessageContent).toHaveBeenCalledWith('Hello', 'text');
    });

    it('should get health status', async () => {
      const healthStatus = await service.getHealthStatus();

      expect(healthStatus).toEqual({
        service: 'CloudApiService',
        status: 'healthy',
        enabled: true,
        migrationMode: false,
        lastCheck: expect.any(String),
        details: { success: true, status: 200 },
        retryHandler: expect.any(Object),
        errorHandling: expect.any(Object)
      });

      expect(mockCloudApiConfig.testConnectivity).toHaveBeenCalled();
    });

    it('should handle health check errors', async () => {
      mockCloudApiConfig.testConnectivity.mockRejectedValue(new Error('Connection failed'));

      const healthStatus = await service.getHealthStatus();

      expect(healthStatus).toEqual({
        service: 'CloudApiService',
        status: 'unhealthy',
        enabled: true,
        migrationMode: false,
        lastCheck: expect.any(String),
        error: expect.any(String),
        errorType: expect.any(String),
        retryHandler: expect.any(Object)
      });
    });

    it('should get configuration summary', () => {
      const summary = service.getConfigSummary();
      
      expect(summary).toEqual({ enabled: true, migrationMode: false });
      expect(mockCloudApiConfig.getConfigSummary).toHaveBeenCalled();
    });
  });
});

describe('CloudApiError', () => {
  it('should create error with all properties', () => {
    const error = new CloudApiError(
      'Test error',
      400,
      'TEST_CODE',
      'trace123',
      { raw: 'data' }
    );

    expect(error.message).toBe('Test error');
    expect(error.status).toBe(400);
    expect(error.code).toBe('TEST_CODE');
    expect(error.fbtraceId).toBe('trace123');
    expect(error.rawResponse).toEqual({ raw: 'data' });
    expect(error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('should identify retryable errors', () => {
    const retryableStatuses = [429, 500, 502, 503, 504];
    const nonRetryableStatuses = [400, 401, 403, 404];

    retryableStatuses.forEach(status => {
      const error = new CloudApiError('Error', status);
      expect(error.isRetryable()).toBe(true);
    });

    nonRetryableStatuses.forEach(status => {
      const error = new CloudApiError('Error', status);
      expect(error.isRetryable()).toBe(false);
    });
  });

  it('should get error details', () => {
    const error = new CloudApiError('Test error', 400, 'TEST_CODE', 'trace123');
    const details = error.getDetails();

    expect(details).toEqual({
      message: 'Test error',
      status: 400,
      code: 'TEST_CODE',
      fbtraceId: 'trace123',
      timestamp: error.timestamp,
      retryable: false
    });
  });
});