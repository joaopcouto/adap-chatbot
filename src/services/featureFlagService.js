import configManager from '../config/config.js';
import { structuredLogger } from '../helpers/logger.js';

/**
 * Feature Flag Service for runtime feature management
 */
class FeatureFlagService {
  constructor() {
    this.configManager = configManager;
    this.listeners = new Map(); // Feature flag change listeners
  }

  /**
   * Check if a feature is enabled
   */
  isEnabled(featureName) {
    return this.configManager.isFeatureEnabled(featureName);
  }

  /**
   * Get all feature flags with their current status
   */
  getAllFlags() {
    return this.configManager.getFeatureFlags();
  }

  /**
   * Update a feature flag at runtime
   */
  updateFlag(featureName, enabled, reason = 'Manual update') {
    try {
      const oldValue = this.isEnabled(featureName);
      const newValue = this.configManager.updateFeatureFlag(featureName, enabled);
      
      // Notify listeners
      this.notifyListeners(featureName, oldValue, newValue, reason);
      
      structuredLogger.info('Feature flag updated via service', {
        feature: featureName,
        oldValue,
        newValue,
        reason,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        feature: featureName,
        oldValue,
        newValue,
        reason
      };
    } catch (error) {
      structuredLogger.error('Failed to update feature flag', {
        feature: featureName,
        enabled,
        reason,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Bulk update multiple feature flags
   */
  updateFlags(updates, reason = 'Bulk update') {
    const results = [];
    
    for (const [featureName, enabled] of Object.entries(updates)) {
      const result = this.updateFlag(featureName, enabled, reason);
      results.push({ feature: featureName, ...result });
    }
    
    return results;
  }

  /**
   * Register a listener for feature flag changes
   */
  onFlagChange(featureName, callback) {
    if (!this.listeners.has(featureName)) {
      this.listeners.set(featureName, new Set());
    }
    
    this.listeners.get(featureName).add(callback);
    
    // Return unsubscribe function
    return () => {
      const callbacks = this.listeners.get(featureName);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.listeners.delete(featureName);
        }
      }
    };
  }

  /**
   * Notify listeners of feature flag changes
   */
  notifyListeners(featureName, oldValue, newValue, reason) {
    const callbacks = this.listeners.get(featureName);
    if (callbacks) {
      callbacks.forEach(callback => {
        try {
          callback({
            feature: featureName,
            oldValue,
            newValue,
            reason,
            timestamp: new Date().toISOString()
          });
        } catch (error) {
          structuredLogger.error('Error in feature flag listener', {
            feature: featureName,
            error: error.message
          });
        }
      });
    }
  }

  /**
   * Get feature flag status with metadata
   */
  getFlagStatus(featureName) {
    const flags = this.getAllFlags();
    
    if (!(featureName in flags)) {
      return {
        exists: false,
        error: 'Feature flag not found'
      };
    }
    
    return {
      exists: true,
      name: featureName,
      enabled: flags[featureName],
      description: this.getFeatureDescription(featureName),
      dependencies: this.getFeatureDependencies(featureName),
      impact: this.getFeatureImpact(featureName)
    };
  }

  /**
   * Get feature description
   */
  getFeatureDescription(featureName) {
    const descriptions = {
      googleCalendarIntegrationEnabled: 'Enables Google Calendar integration for reminders',
      syncRetryEnabled: 'Enables automatic retry of failed sync operations',
      backgroundSyncEnabled: 'Enables background processing of sync operations',
      alertingEnabled: 'Enables system alerting and monitoring',
      metricsCollectionEnabled: 'Enables collection of system metrics',
      enhancedLoggingEnabled: 'Enables detailed logging for debugging',
      debugModeEnabled: 'Enables debug mode with additional logging and validation'
    };
    
    return descriptions[featureName] || 'No description available';
  }

  /**
   * Get feature dependencies
   */
  getFeatureDependencies(featureName) {
    const dependencies = {
      googleCalendarIntegrationEnabled: [],
      syncRetryEnabled: ['googleCalendarIntegrationEnabled'],
      backgroundSyncEnabled: ['googleCalendarIntegrationEnabled'],
      alertingEnabled: [],
      metricsCollectionEnabled: [],
      enhancedLoggingEnabled: [],
      debugModeEnabled: []
    };
    
    return dependencies[featureName] || [];
  }

  /**
   * Get feature impact level
   */
  getFeatureImpact(featureName) {
    const impacts = {
      googleCalendarIntegrationEnabled: 'high', // Core feature
      syncRetryEnabled: 'medium', // Affects reliability
      backgroundSyncEnabled: 'medium', // Affects performance
      alertingEnabled: 'low', // Monitoring only
      metricsCollectionEnabled: 'low', // Monitoring only
      enhancedLoggingEnabled: 'low', // Debugging only
      debugModeEnabled: 'low' // Development only
    };
    
    return impacts[featureName] || 'unknown';
  }

  /**
   * Validate feature flag dependencies
   */
  validateDependencies(featureName, enabled) {
    if (!enabled) {
      return { valid: true }; // Disabling a feature doesn't break dependencies
    }
    
    const dependencies = this.getFeatureDependencies(featureName);
    const currentFlags = this.getAllFlags();
    const missingDependencies = [];
    
    for (const dependency of dependencies) {
      if (!currentFlags[dependency]) {
        missingDependencies.push(dependency);
      }
    }
    
    if (missingDependencies.length > 0) {
      return {
        valid: false,
        error: `Missing required dependencies: ${missingDependencies.join(', ')}`
      };
    }
    
    return { valid: true };
  }

  /**
   * Safe feature flag update with dependency validation
   */
  safeUpdateFlag(featureName, enabled, reason = 'Safe update') {
    // Validate dependencies
    const validation = this.validateDependencies(featureName, enabled);
    if (!validation.valid) {
      return {
        success: false,
        error: validation.error
      };
    }
    
    return this.updateFlag(featureName, enabled, reason);
  }

  /**
   * Get feature flag health check
   */
  getHealthCheck() {
    const flags = this.getAllFlags();
    const health = {
      totalFlags: Object.keys(flags).length,
      enabledFlags: Object.values(flags).filter(Boolean).length,
      disabledFlags: Object.values(flags).filter(v => !v).length,
      flags: {},
      issues: []
    };
    
    // Check each flag
    for (const [name, enabled] of Object.entries(flags)) {
      const status = this.getFlagStatus(name);
      health.flags[name] = {
        enabled,
        impact: status.impact,
        dependencies: status.dependencies
      };
      
      // Check for dependency issues
      if (enabled) {
        const validation = this.validateDependencies(name, enabled);
        if (!validation.valid) {
          health.issues.push({
            flag: name,
            issue: validation.error,
            severity: 'warning'
          });
        }
      }
    }
    
    return health;
  }

  /**
   * Export current configuration for backup/restore
   */
  exportConfiguration() {
    return {
      featureFlags: this.getAllFlags(),
      timestamp: new Date().toISOString(),
      version: '1.0'
    };
  }

  /**
   * Import configuration from backup
   */
  importConfiguration(config, reason = 'Configuration import') {
    if (!config.featureFlags) {
      return {
        success: false,
        error: 'Invalid configuration format'
      };
    }
    
    const results = this.updateFlags(config.featureFlags, reason);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    return {
      success: failed === 0,
      imported: successful,
      failed,
      results
    };
  }
}

// Create singleton instance
const featureFlagService = new FeatureFlagService();

export default featureFlagService;
export { FeatureFlagService };