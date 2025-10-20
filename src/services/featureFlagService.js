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
      debugModeEnabled: 'Enables debug mode with additional logging and validation',
      whatsappCloudApiEnabled: 'Enables WhatsApp Cloud API as the primary messaging service',
      whatsappCloudApiMigrationMode: 'Enables gradual migration mode with percentage-based traffic routing'
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
      debugModeEnabled: [],
      whatsappCloudApiEnabled: [],
      whatsappCloudApiMigrationMode: []
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
      debugModeEnabled: 'low', // Development only
      whatsappCloudApiEnabled: 'critical', // Changes messaging provider
      whatsappCloudApiMigrationMode: 'high' // Affects traffic routing
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

  /**
   * Get migration traffic percentage for Cloud API
   */
  getMigrationTrafficPercentage() {
    return this.configManager.get('migration.cloudApiTrafficPercentage', 0);
  }

  /**
   * Update migration traffic percentage
   */
  updateMigrationTrafficPercentage(percentage, reason = 'Migration traffic update') {
    if (percentage < 0 || percentage > 100) {
      return {
        success: false,
        error: 'Percentage must be between 0 and 100'
      };
    }

    try {
      const oldValue = this.getMigrationTrafficPercentage();
      this.configManager.updateMigrationConfig('cloudApiTrafficPercentage', percentage);
      
      // Notify listeners
      this.notifyListeners('migrationTrafficPercentage', oldValue, percentage, reason);
      
      structuredLogger.info('Migration traffic percentage updated', {
        oldValue,
        newValue: percentage,
        reason,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        oldValue,
        newValue: percentage,
        reason
      };
    } catch (error) {
      structuredLogger.error('Failed to update migration traffic percentage', {
        percentage,
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
   * Get migration status and configuration
   */
  getMigrationStatus() {
    const migrationMode = this.isEnabled('whatsappCloudApiMigrationMode');
    const cloudApiEnabled = this.isEnabled('whatsappCloudApiEnabled');
    const trafficPercentage = this.getMigrationTrafficPercentage();
    
    let status = 'not_started';
    if (cloudApiEnabled && !migrationMode) {
      status = 'completed';
    } else if (migrationMode) {
      if (trafficPercentage === 0) {
        status = 'ready';
      } else if (trafficPercentage < 100) {
        status = 'in_progress';
      } else {
        status = 'ready_for_completion';
      }
    }
    
    return {
      status,
      migrationMode,
      cloudApiEnabled,
      trafficPercentage,
      canStart: !migrationMode && !cloudApiEnabled,
      canIncrease: migrationMode && trafficPercentage < 100,
      canDecrease: migrationMode && trafficPercentage > 0,
      canComplete: migrationMode && trafficPercentage === 100,
      canRollback: migrationMode || cloudApiEnabled
    };
  }

  /**
   * Start migration process
   */
  startMigration(initialPercentage = 5, reason = 'Migration started') {
    const status = this.getMigrationStatus();
    
    if (!status.canStart) {
      return {
        success: false,
        error: 'Migration cannot be started in current state'
      };
    }
    
    try {
      // Enable migration mode
      const migrationResult = this.updateFlag('whatsappCloudApiMigrationMode', true, reason);
      if (!migrationResult.success) {
        return migrationResult;
      }
      
      // Set initial traffic percentage
      const trafficResult = this.updateMigrationTrafficPercentage(initialPercentage, reason);
      if (!trafficResult.success) {
        // Rollback migration mode
        this.updateFlag('whatsappCloudApiMigrationMode', false, 'Rollback due to traffic update failure');
        return trafficResult;
      }
      
      structuredLogger.info('Migration started', {
        initialPercentage,
        reason,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        message: `Migration started with ${initialPercentage}% traffic to Cloud API`,
        initialPercentage,
        reason
      };
    } catch (error) {
      structuredLogger.error('Failed to start migration', {
        initialPercentage,
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
   * Complete migration process
   */
  completeMigration(reason = 'Migration completed') {
    const status = this.getMigrationStatus();
    
    if (!status.canComplete) {
      return {
        success: false,
        error: 'Migration cannot be completed in current state. Traffic must be at 100%.'
      };
    }
    
    try {
      // Enable Cloud API fully
      const cloudApiResult = this.updateFlag('whatsappCloudApiEnabled', true, reason);
      if (!cloudApiResult.success) {
        return cloudApiResult;
      }
      
      // Disable migration mode
      const migrationResult = this.updateFlag('whatsappCloudApiMigrationMode', false, reason);
      if (!migrationResult.success) {
        // Rollback Cloud API flag
        this.updateFlag('whatsappCloudApiEnabled', false, 'Rollback due to migration mode update failure');
        return migrationResult;
      }
      
      structuredLogger.info('Migration completed', {
        reason,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        message: 'Migration completed successfully. All traffic now uses Cloud API.',
        reason
      };
    } catch (error) {
      structuredLogger.error('Failed to complete migration', {
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
   * Rollback migration process
   */
  rollbackMigration(reason = 'Migration rollback') {
    const status = this.getMigrationStatus();
    
    if (!status.canRollback) {
      return {
        success: false,
        error: 'Migration cannot be rolled back in current state'
      };
    }
    
    try {
      // Disable Cloud API
      const cloudApiResult = this.updateFlag('whatsappCloudApiEnabled', false, reason);
      if (!cloudApiResult.success) {
        return cloudApiResult;
      }
      
      // Disable migration mode
      const migrationResult = this.updateFlag('whatsappCloudApiMigrationMode', false, reason);
      if (!migrationResult.success) {
        return migrationResult;
      }
      
      // Reset traffic percentage
      const trafficResult = this.updateMigrationTrafficPercentage(0, reason);
      if (!trafficResult.success) {
        structuredLogger.warn('Failed to reset traffic percentage during rollback', {
          error: trafficResult.error
        });
      }
      
      structuredLogger.info('Migration rolled back', {
        reason,
        timestamp: new Date().toISOString()
      });
      
      return {
        success: true,
        message: 'Migration rolled back successfully. All traffic now uses Twilio.',
        reason
      };
    } catch (error) {
      structuredLogger.error('Failed to rollback migration', {
        reason,
        error: error.message
      });
      
      return {
        success: false,
        error: error.message
      };
    }
  }
}

// Create singleton instance
const featureFlagService = new FeatureFlagService();

export default featureFlagService;
export { FeatureFlagService };