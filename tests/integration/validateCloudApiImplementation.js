#!/usr/bin/env node

/**
 * Cloud API Implementation Validation Script
 * 
 * This script validates that the Cloud API implementation is working correctly
 * by testing core functionality without requiring complex mocking.
 */

import { CloudApiService } from '../../src/services/cloudApiService.js';
import cloudApiConfig from '../../src/config/cloudApiConfig.js';
import { structuredLogger } from '../../src/helpers/logger.js';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function log(message, color = 'reset') {
  console.log(colorize(message, color));
}

function logHeader(message) {
  console.log('\n' + '='.repeat(80));
  console.log(colorize(message, 'bright'));
  console.log('='.repeat(80));
}

function logSubHeader(message) {
  console.log('\n' + colorize(message, 'cyan'));
  console.log('-'.repeat(message.length));
}

// Test configuration
const testConfig = {
  NODE_ENV: 'test',
  WHATSAPP_CLOUD_API_ENABLED: 'true',
  WHATSAPP_ACCESS_TOKEN: 'test_access_token_123',
  WHATSAPP_PHONE_NUMBER_ID: '123456789',
  WHATSAPP_BUSINESS_ACCOUNT_ID: 'test_business_account',
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'test_verify_token_123',
  WHATSAPP_API_VERSION: 'v18.0',
  WHATSAPP_CLOUD_API_URL: 'https://graph.facebook.com',
  // Required for config validation
  MONGO_URI: 'mongodb://localhost:27017/test',
  TWILIO_ACCOUNT_SID: 'test_twilio_sid',
  TWILIO_AUTH_TOKEN: 'test_twilio_token',
  TWILIO_PHONE_NUMBER: '+1234567890',
  OPENAI_API_KEY: 'test_openai_key'
};

// Test results tracking
const testResults = {
  passed: 0,
  failed: 0,
  total: 0,
  failures: []
};

function runTest(testName, testFunction) {
  testResults.total++;
  
  try {
    const result = testFunction();
    if (result === true || result === undefined) {
      testResults.passed++;
      log(`✅ ${testName}`, 'green');
      return true;
    } else {
      testResults.failed++;
      testResults.failures.push({ name: testName, error: 'Test returned false' });
      log(`❌ ${testName} - Test returned false`, 'red');
      return false;
    }
  } catch (error) {
    testResults.failed++;
    testResults.failures.push({ name: testName, error: error.message });
    log(`❌ ${testName} - ${error.message}`, 'red');
    return false;
  }
}

async function runAsyncTest(testName, testFunction) {
  testResults.total++;
  
  try {
    const result = await testFunction();
    if (result === true || result === undefined) {
      testResults.passed++;
      log(`✅ ${testName}`, 'green');
      return true;
    } else {
      testResults.failed++;
      testResults.failures.push({ name: testName, error: 'Test returned false' });
      log(`❌ ${testName} - Test returned false`, 'red');
      return false;
    }
  } catch (error) {
    testResults.failed++;
    testResults.failures.push({ name: testName, error: error.message });
    log(`❌ ${testName} - ${error.message}`, 'red');
    return false;
  }
}

function setupTestEnvironment() {
  logSubHeader('Setting up test environment');
  
  // Set test environment variables
  Object.keys(testConfig).forEach(key => {
    process.env[key] = testConfig[key];
  });
  
  // Force reload of config modules to pick up new environment variables
  const configPath = new URL('../../src/config/config.js', import.meta.url).pathname;
  const cloudApiConfigPath = new URL('../../src/config/cloudApiConfig.js', import.meta.url).pathname;
  
  // Clear module cache if using CommonJS (not applicable for ES modules)
  // For ES modules, we need to reimport after setting env vars
  
  log('✅ Test environment variables set', 'green');
}

function validateServiceInitialization() {
  logSubHeader('Service Initialization Tests');
  
  runTest('CloudApiService should initialize successfully', () => {
    const service = new CloudApiService();
    return service instanceof CloudApiService;
  });
  
  runTest('Service should have required components', () => {
    const service = new CloudApiService();
    return service.config && service.retryHandler && service.errorHandler && service.metricsCollector;
  });
  
  runTest('Configuration should be accessible', () => {
    const service = new CloudApiService();
    const config = service.config.getConfig();
    return config.accessToken === testConfig.WHATSAPP_ACCESS_TOKEN &&
           config.phoneNumberId === testConfig.WHATSAPP_PHONE_NUMBER_ID;
  });
}

function validatePhoneNumberFormatting() {
  logSubHeader('Phone Number Formatting Tests');
  
  const service = new CloudApiService();
  
  runTest('Should format Brazilian phone numbers correctly', () => {
    const testCases = [
      { input: '11999999999', expected: '5511999999999' },
      { input: '+5511999999999', expected: '5511999999999' },
      { input: 'whatsapp:+5511999999999', expected: '5511999999999' },
      { input: '5511999999999', expected: '5511999999999' }
    ];
    
    return testCases.every(({ input, expected }) => {
      const result = service.formatPhoneNumber(input);
      return result === expected;
    });
  });
  
  runTest('Should reject invalid phone numbers', () => {
    const invalidNumbers = ['', '123', 'invalid'];
    
    return invalidNumbers.every(number => {
      try {
        service.formatPhoneNumber(number);
        return false; // Should have thrown an error
      } catch (error) {
        return true; // Expected to throw
      }
    });
  });
}

function validateMessageContentValidation() {
  logSubHeader('Message Content Validation Tests');
  
  const service = new CloudApiService();
  
  runTest('Should validate correct message content', () => {
    const validMessages = [
      'Hello world',
      'This is a test message',
      'Message with numbers 123',
      'Message with emojis 😀🎉'
    ];
    
    return validMessages.every(message => {
      try {
        return service.validateMessageContent(message, 'text');
      } catch (error) {
        return false;
      }
    });
  });
  
  runTest('Should reject invalid message content', () => {
    const invalidMessages = ['', null, undefined, '   '];
    
    return invalidMessages.every(message => {
      try {
        service.validateMessageContent(message, 'text');
        return false; // Should have thrown an error
      } catch (error) {
        return true; // Expected to throw
      }
    });
  });
  
  runTest('Should reject messages that are too long', () => {
    const longMessage = 'a'.repeat(5000);
    
    try {
      service.validateMessageContent(longMessage, 'text');
      return false; // Should have thrown an error
    } catch (error) {
      return true; // Expected to throw
    }
  });
}

function validateMediaUrlValidation() {
  logSubHeader('Media URL Validation Tests');
  
  const service = new CloudApiService();
  
  runTest('Should validate correct media URLs', () => {
    const validUrls = [
      'https://example.com/image.jpg',
      'https://example.com/document.pdf',
      'https://example.com/video.mp4',
      'http://example.com/file.png'
    ];
    
    return validUrls.every(url => {
      try {
        return service.validateMediaUrl(url);
      } catch (error) {
        return false;
      }
    });
  });
  
  runTest('Should reject invalid media URLs', () => {
    const invalidUrls = [
      'not_a_url',
      'ftp://example.com/file.txt',
      '',
      null,
      undefined
    ];
    
    return invalidUrls.every(url => {
      try {
        service.validateMediaUrl(url);
        return false; // Should have thrown an error
      } catch (error) {
        return true; // Expected to throw
      }
    });
  });
}

function validateMediaTypeDetection() {
  logSubHeader('Media Type Detection Tests');
  
  const service = new CloudApiService();
  
  runTest('Should detect media types correctly', () => {
    const testCases = [
      { url: 'https://example.com/image.jpg', expected: 'image' },
      { url: 'https://example.com/video.mp4', expected: 'video' },
      { url: 'https://example.com/audio.mp3', expected: 'audio' },
      { url: 'https://example.com/document.pdf', expected: 'document' },
      { url: 'https://example.com/unknown.xyz', expected: 'document' }
    ];
    
    return testCases.every(({ url, expected }) => {
      const result = service.detectMediaType(url);
      return result === expected;
    });
  });
}

function validateTemplateComponents() {
  logSubHeader('Template Components Tests');
  
  const service = new CloudApiService();
  
  runTest('Should build template components correctly', () => {
    const variables = {
      body: ['John Doe', '100.50'],
      header: ['Invoice #123']
    };
    
    const components = service.buildTemplateComponents(variables);
    
    return components.length === 2 &&
           components[0].type === 'body' &&
           components[0].parameters.length === 2 &&
           components[1].type === 'header' &&
           components[1].parameters.length === 1;
  });
  
  runTest('Should handle single parameter templates', () => {
    const variables = {
      body: 'Single parameter'
    };
    
    const components = service.buildTemplateComponents(variables);
    
    return components.length === 1 &&
           components[0].type === 'body' &&
           components[0].parameters.length === 1 &&
           components[0].parameters[0].text === 'Single parameter';
  });
  
  runTest('Should handle empty variables', () => {
    const variables = {};
    const components = service.buildTemplateComponents(variables);
    return components.length === 0;
  });
}

function validateParameterTypeDetection() {
  logSubHeader('Parameter Type Detection Tests');
  
  const service = new CloudApiService();
  
  runTest('Should detect parameter types correctly', () => {
    const testCases = [
      { value: 'Hello', expected: 'text' },
      { value: 123, expected: 'text' },
      { value: '2024-01-15', expected: 'date_time' },
      { value: 'https://example.com/image.jpg', expected: 'document' },
      { value: true, expected: 'text' }
    ];
    
    return testCases.every(({ value, expected }) => {
      const result = service.getParameterType(value);
      return result === expected;
    });
  });
}

function validateUtilityMethods() {
  logSubHeader('Utility Methods Tests');
  
  const service = new CloudApiService();
  
  runTest('Should generate unique request IDs', () => {
    const id1 = service.generateRequestId();
    const id2 = service.generateRequestId();
    
    return id1 !== id2 &&
           id1.match(/^req_\d+_[a-z0-9]+$/) &&
           id2.match(/^req_\d+_[a-z0-9]+$/);
  });
  
  runTest('Should return media type specifications', () => {
    const specs = service.getMediaTypeSpecs();
    
    return specs.image && specs.video && specs.audio && specs.document &&
           specs.image.supportsCaption === true &&
           specs.audio.supportsCaption === false;
  });
}

async function validateHealthStatus() {
  logSubHeader('Health Status Tests');
  
  const service = new CloudApiService();
  
  await runAsyncTest('Should return health status structure', async () => {
    // Mock the connectivity test to avoid actual API calls
    const originalTestConnectivity = service.config.testConnectivity;
    service.config.testConnectivity = () => Promise.resolve({
      success: true,
      responseTime: 100
    });
    
    const healthStatus = await service.getHealthStatus();
    
    // Restore original method
    service.config.testConnectivity = originalTestConnectivity;
    
    return healthStatus.service === 'CloudApiService' &&
           typeof healthStatus.status === 'string' &&
           typeof healthStatus.enabled === 'boolean' &&
           typeof healthStatus.lastCheck === 'string';
  });
}

function validateErrorHandling() {
  logSubHeader('Error Handling Setup Tests');
  
  const service = new CloudApiService();
  
  runTest('Should have error handler configured', () => {
    return service.errorHandler &&
           typeof service.errorHandler.handleError === 'function';
  });
  
  runTest('Should have retry handler configured', () => {
    return service.retryHandler &&
           typeof service.retryHandler.executeWithRetry === 'function' &&
           service.retryHandler.isHealthy() === true;
  });
  
  runTest('Should have metrics collector configured', () => {
    return service.metricsCollector &&
           typeof service.metricsCollector.recordRequest === 'function' &&
           typeof service.metricsCollector.recordMessage === 'function';
  });
}

function validateConfiguration() {
  logSubHeader('Configuration Tests');
  
  const service = new CloudApiService();
  
  runTest('Should check if service is enabled', () => {
    return service.config.isEnabled() === true;
  });
  
  runTest('Should get API URL correctly', () => {
    const url = service.config.getApiUrl('messages');
    return url.includes(testConfig.WHATSAPP_CLOUD_API_URL) &&
           url.includes(testConfig.WHATSAPP_PHONE_NUMBER_ID) &&
           url.includes('messages');
  });
  
  runTest('Should get request headers correctly', () => {
    const headers = service.config.getRequestHeaders();
    return headers['Authorization'] === `Bearer ${testConfig.WHATSAPP_ACCESS_TOKEN}` &&
           headers['Content-Type'] === 'application/json';
  });
}

function generateReport() {
  logSubHeader('Test Results Summary');
  
  const successRate = testResults.total > 0 ? 
    (testResults.passed / testResults.total * 100).toFixed(2) : 0;
  
  log(`Total Tests: ${testResults.total}`, 'blue');
  log(`Passed: ${testResults.passed}`, testResults.passed > 0 ? 'green' : 'reset');
  log(`Failed: ${testResults.failed}`, testResults.failed > 0 ? 'red' : 'reset');
  log(`Success Rate: ${successRate}%`, 
      successRate >= 80 ? 'green' : 
      successRate >= 60 ? 'yellow' : 'red');
  
  if (testResults.failures.length > 0) {
    logSubHeader('Failed Tests Details');
    testResults.failures.forEach(failure => {
      log(`❌ ${failure.name}: ${failure.error}`, 'red');
    });
  }
  
  return {
    total: testResults.total,
    passed: testResults.passed,
    failed: testResults.failed,
    successRate: parseFloat(successRate),
    failures: testResults.failures
  };
}

async function main() {
  logHeader('Cloud API Implementation Validation');
  
  log('This script validates the Cloud API implementation without making actual API calls.', 'blue');
  log('It tests core functionality, configuration, and error handling.', 'blue');
  
  try {
    // Setup test environment
    setupTestEnvironment();
    
    // Run all validation tests
    validateServiceInitialization();
    validatePhoneNumberFormatting();
    validateMessageContentValidation();
    validateMediaUrlValidation();
    validateMediaTypeDetection();
    validateTemplateComponents();
    validateParameterTypeDetection();
    validateUtilityMethods();
    await validateHealthStatus();
    validateErrorHandling();
    validateConfiguration();
    
    // Generate and display report
    const report = generateReport();
    
    // Determine exit code
    if (report.failed === 0) {
      logHeader('✅ All validation tests passed successfully!');
      log('The Cloud API implementation is working correctly.', 'green');
      process.exit(0);
    } else {
      logHeader('❌ Some validation tests failed.');
      log('Please review the failed tests above and fix the issues.', 'red');
      process.exit(1);
    }
    
  } catch (error) {
    log(`💥 Fatal error during validation: ${error.message}`, 'red');
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle process signals
process.on('SIGINT', () => {
  log('\n⚠️  Validation interrupted by user', 'yellow');
  process.exit(130);
});

process.on('SIGTERM', () => {
  log('\n⚠️  Validation terminated', 'yellow');
  process.exit(143);
});

// Run the validation
main().catch(error => {
  log(`💥 Fatal error: ${error.message}`, 'red');
  console.error(error.stack);
  process.exit(1);
});