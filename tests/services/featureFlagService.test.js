import { jest } from '@jest/globals';
import { FeatureFlagService } from '../../src/services/featureFlagService.js';

// Mock the config manager
const mockConfigManager = {
  isFeatureEnabled: jest.fn(),
  getFeatureFlags: jest.fn(),
  updateFeatureFlag: jest.fn()
};

// Mock the logger
jest.mock('../../src/helpers/logger.js', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn()
  }
}));

describe('FeatureFlagService', () => {
  let service;

  beforeEach(() => {
    service = new FeatureFlagService();
    service.configManager = mockConfigManager;
    
    // Reset mocks
    jest.clearAllMocks();
    
    // Default mock implementations
    mockConfigManager.getFeatureFlags.mockReturnValue({
      googleCalendarIntegrationEnabled: true,
      syncRetryEnabled: true,
      backgroundSyncEnabled: false,
      alertingEnabled: true,
      debugModeEnabled: false
    });
  });

  describe('Feature Flag Checking', () => {
    test('should check if feature is enabled', () => {
      mockConfigManager.isFeatureEnabled.mockReturnValue(true);
      
      const result = service.isEnabled('googleCalendarIntegrationEnabled');
      
      expect(result).toBe(true);
      expect(mockConfigManager.isFeatureEnabled).toHaveBeenCalledWith('googleCalendarIntegrationEnabled');
    });

    test('should return all feature flags', () => {
      const flags = service.getAllFlags();
      
      expect(flags).toEqual({
        googleCalendarIntegrationEnabled: true,
        syncRetryEnabled: true,
        backgroundSyncEnabled: false,
        alertingEnabled: true,
        debugModeEnabled: false
      });
    });
  });

  describe('Feature Flag Updates', () => {
    test('should update feature flag successfully', () => {
      mockConfigManager.updateFeatureFlag.mockReturnValue(true);
      mockConfigManager.isFeatureEnabled.mockReturnValue(false);
      
      const result = service.updateFlag('debugModeEnabled', true, 'Test update');
      
      expect(result.success).toBe(true);
      expect(result.feature).toBe('debugModeEnabled');
      expect(result.newValue).toBe(true);
      expect(result.reason).toBe('Test update');
      expect(mockConfigManager.updateFeatureFlag).toHaveBeenCalledWith('debugModeEnabled', true);
    });

    test('should handle update errors', () => {
      mockConfigManager.updateFeatureFlag.mockImplementation(() => {
        throw new Error('Update failed');
      });
      
      const result = service.updateFlag('debugModeEnabled', true);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
    });

    test('should bulk update multiple flags', () => {
      mockConfigManager.updateFeatureFlag.mockReturnValue(true);
      mockConfigManager.isFeatureEnabled.mockReturnValue(false);
      
      const updates = {
        debugModeEnabled: true,
        alertingEnabled: false
      };
      
      const results = service.updateFlags(updates, 'Bulk test');
      
      expect(results).toHaveLength(2);
      expect(results[0].success).toBe(true);
      expect(results[1].success).toBe(true);
      expect(mockConfigManager.updateFeatureFlag).toHaveBeenCalledTimes(2);
    });
  });

  describe('Feature Flag Listeners', () => {
    test('should register and notify listeners', () => {
      const listener = jest.fn();
      
      const unsubscribe = service.onFlagChange('debugModeEnabled', listener);
      
      // Trigger a change
      mockConfigManager.updateFeatureFlag.mockReturnValue(true);
      mockConfigManager.isFeatureEnabled.mockReturnValueOnce(false).mockReturnValueOnce(true);
      
      service.updateFlag('debugModeEnabled', true, 'Test');
      
      expect(listener).toHaveBeenCalledWith({
        feature: 'debugModeEnabled',
        oldValue: false,
        newValue: true,
        reason: 'Test',
        timestamp: expect.any(String)
      });
      
      // Test unsubscribe
      unsubscribe();
      service.updateFlag('debugModeEnabled', false, 'Test 2');
      
      expect(listener).toHaveBeenCalledTimes(1); // Should not be called again
    });

    test('should handle listener errors gracefully', () => {
      const faultyListener = jest.fn().mockImplementation(() => {
        throw new Error('Listener error');
      });
      
      service.onFlagChange('debugModeEnabled', faultyListener);
      
      mockConfigManager.updateFeatureFlag.mockReturnValue(true);
      mockConfigManager.isFeatureEnabled.mockReturnValueOnce(false).mockReturnValueOnce(true);
      
      // Should not throw
      expect(() => {
        service.updateFlag('debugModeEnabled', true, 'Test');
      }).not.toThrow();
    });
  });

  describe('Feature Flag Status', () => {
    test('should get feature flag status with metadata', () => {
      const status = service.getFlagStatus('googleCalendarIntegrationEnabled');
      
      expect(status.exists).toBe(true);
      expect(status.name).toBe('googleCalendarIntegrationEnabled');
      expect(status.enabled).toBe(true);
      expect(status.description).toContain('Google Calendar integration');
      expect(status.dependencies).toEqual([]);
      expect(status.impact).toBe('high');
    });

    test('should handle non-existent feature flag', () => {
      const status = service.getFlagStatus('nonExistentFlag');
      
      expect(status.exists).toBe(false);
      expect(status.error).toBe('Feature flag not found');
    });

    test('should return correct dependencies', () => {
      const status = service.getFlagStatus('syncRetryEnabled');
      
      expect(status.dependencies).toContain('googleCalendarIntegrationEnabled');
    });
  });

  describe('Dependency Validation', () => {
    test('should validate dependencies when enabling feature', () => {
      // Mock syncRetryEnabled depends on googleCalendarIntegrationEnabled
      mockConfigManager.getFeatureFlags.mockReturnValue({
        googleCalendarIntegrationEnabled: false,
        syncRetryEnabled: false
      });
      
      const validation = service.validateDependencies('syncRetryEnabled', true);
      
      expect(validation.valid).toBe(false);
      expect(validation.error).toContain('googleCalendarIntegrationEnabled');
    });

    test('should allow disabling feature regardless of dependencies', () => {
      const validation = service.validateDependencies('googleCalendarIntegrationEnabled', false);
      
      expect(validation.valid).toBe(true);
    });

    test('should validate successfully when dependencies are met', () => {
      mockConfigManager.getFeatureFlags.mockReturnValue({
        googleCalendarIntegrationEnabled: true,
        syncRetryEnabled: false
      });
      
      const validation = service.validateDependencies('syncRetryEnabled', true);
      
      expect(validation.valid).toBe(true);
    });
  });

  describe('Safe Updates', () => {
    test('should perform safe update with dependency validation', () => {
      mockConfigManager.getFeatureFlags.mockReturnValue({
        googleCalendarIntegrationEnabled: true,
        syncRetryEnabled: false
      });
      mockConfigManager.updateFeatureFlag.mockReturnValue(true);
      mockConfigManager.isFeatureEnabled.mockReturnValue(false);
      
      const result = service.safeUpdateFlag('syncRetryEnabled', true, 'Safe test');
      
      expect(result.success).toBe(true);
    });

    test('should reject unsafe update due to missing dependencies', () => {
      mockConfigManager.getFeatureFlags.mockReturnValue({
        googleCalendarIntegrationEnabled: false,
        syncRetryEnabled: false
      });
      
      const result = service.safeUpdateFlag('syncRetryEnabled', true, 'Unsafe test');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Missing required dependencies');
    });
  });

  describe('Health Check', () => {
    test('should return comprehensive health check', () => {
      const health = service.getHealthCheck();
      
      expect(health).toHaveProperty('totalFlags');
      expect(health).toHaveProperty('enabledFlags');
      expect(health).toHaveProperty('disabledFlags');
      expect(health).toHaveProperty('flags');
      expect(health).toHaveProperty('issues');
      
      expect(health.totalFlags).toBe(5);
      expect(health.enabledFlags).toBe(3);
      expect(health.disabledFlags).toBe(2);
    });

    test('should identify dependency issues in health check', () => {
      // Mock a scenario where syncRetryEnabled is true but dependency is false
      mockConfigManager.getFeatureFlags.mockReturnValue({
        googleCalendarIntegrationEnabled: false,
        syncRetryEnabled: true,
        backgroundSyncEnabled: false,
        alertingEnabled: true,
        debugModeEnabled: false
      });
      
      const health = service.getHealthCheck();
      
      expect(health.issues).toHaveLength(1);
      expect(health.issues[0].flag).toBe('syncRetryEnabled');
      expect(health.issues[0].severity).toBe('warning');
    });
  });

  describe('Configuration Export/Import', () => {
    test('should export configuration', () => {
      const exported = service.exportConfiguration();
      
      expect(exported).toHaveProperty('featureFlags');
      expect(exported).toHaveProperty('timestamp');
      expect(exported).toHaveProperty('version');
      expect(exported.version).toBe('1.0');
    });

    test('should import configuration successfully', () => {
      mockConfigManager.updateFeatureFlag.mockReturnValue(true);
      mockConfigManager.isFeatureEnabled.mockReturnValue(false);
      
      const config = {
        featureFlags: {
          debugModeEnabled: true,
          alertingEnabled: false
        }
      };
      
      const result = service.importConfiguration(config, 'Test import');
      
      expect(result.success).toBe(true);
      expect(result.imported).toBe(2);
      expect(result.failed).toBe(0);
    });

    test('should handle invalid import configuration', () => {
      const config = { invalid: 'config' };
      
      const result = service.importConfiguration(config);
      
      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid configuration format');
    });
  });
});