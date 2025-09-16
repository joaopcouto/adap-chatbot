import express from 'express';
import configManager from '../config/config.js';
import featureFlagService from '../services/featureFlagService.js';
import { structuredLogger } from '../helpers/logger.js';

const router = express.Router();

/**
 * Get current configuration (sanitized)
 */
router.get('/config', (req, res) => {
  try {
    const config = configManager.getAllConfig();
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    structuredLogger.error('Failed to get configuration', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configuration'
    });
  }
});

/**
 * Get configuration documentation
 */
router.get('/config/docs', (req, res) => {
  try {
    const docs = configManager.getConfigurationDocs();
    res.json({
      success: true,
      data: docs
    });
  } catch (error) {
    structuredLogger.error('Failed to get configuration docs', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configuration documentation'
    });
  }
});

/**
 * Get all feature flags
 */
router.get('/features', (req, res) => {
  try {
    const flags = featureFlagService.getAllFlags();
    const health = featureFlagService.getHealthCheck();
    
    res.json({
      success: true,
      data: {
        flags,
        health
      }
    });
  } catch (error) {
    structuredLogger.error('Failed to get feature flags', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feature flags'
    });
  }
});

/**
 * Get specific feature flag status
 */
router.get('/features/:featureName', (req, res) => {
  try {
    const { featureName } = req.params;
    const status = featureFlagService.getFlagStatus(featureName);
    
    if (!status.exists) {
      return res.status(404).json({
        success: false,
        error: status.error
      });
    }
    
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    structuredLogger.error('Failed to get feature flag status', { 
      feature: req.params.featureName,
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feature flag status'
    });
  }
});

/**
 * Update a feature flag
 */
router.put('/features/:featureName', (req, res) => {
  try {
    const { featureName } = req.params;
    const { enabled, reason } = req.body;
    
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({
        success: false,
        error: 'enabled field must be a boolean'
      });
    }
    
    const result = featureFlagService.safeUpdateFlag(
      featureName, 
      enabled, 
      reason || `API update by ${req.ip}`
    );
    
    if (!result.success) {
      return res.status(400).json(result);
    }
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    structuredLogger.error('Failed to update feature flag', { 
      feature: req.params.featureName,
      error: error.message 
    });
    res.status(500).json({
      success: false,
      error: 'Failed to update feature flag'
    });
  }
});

/**
 * Bulk update feature flags
 */
router.put('/features', (req, res) => {
  try {
    const { flags, reason } = req.body;
    
    if (!flags || typeof flags !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'flags field must be an object'
      });
    }
    
    // Validate all flags are boolean
    for (const [name, enabled] of Object.entries(flags)) {
      if (typeof enabled !== 'boolean') {
        return res.status(400).json({
          success: false,
          error: `Flag ${name} must be a boolean, got ${typeof enabled}`
        });
      }
    }
    
    const results = featureFlagService.updateFlags(
      flags, 
      reason || `Bulk API update by ${req.ip}`
    );
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    res.json({
      success: failed === 0,
      data: {
        updated: successful,
        failed,
        results
      }
    });
  } catch (error) {
    structuredLogger.error('Failed to bulk update feature flags', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update feature flags'
    });
  }
});

/**
 * Get feature flag health check
 */
router.get('/features/health', (req, res) => {
  try {
    const health = featureFlagService.getHealthCheck();
    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    structuredLogger.error('Failed to get feature flag health', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve feature flag health'
    });
  }
});

/**
 * Export current configuration
 */
router.get('/export', (req, res) => {
  try {
    const config = featureFlagService.exportConfiguration();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="config-${Date.now()}.json"`);
    res.json(config);
  } catch (error) {
    structuredLogger.error('Failed to export configuration', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to export configuration'
    });
  }
});

/**
 * Import configuration
 */
router.post('/import', (req, res) => {
  try {
    const config = req.body;
    const reason = `Configuration import by ${req.ip}`;
    
    const result = featureFlagService.importConfiguration(config, reason);
    
    if (!result.success) {
      return res.status(400).json({
        success: false,
        error: result.error,
        data: result
      });
    }
    
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    structuredLogger.error('Failed to import configuration', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to import configuration'
    });
  }
});

/**
 * Reset all feature flags to defaults
 */
router.post('/features/reset', (req, res) => {
  try {
    const { reason } = req.body;
    
    // Get default flags (from environment or hardcoded defaults)
    const defaultFlags = {
      googleCalendarIntegrationEnabled: true,
      syncRetryEnabled: true,
      backgroundSyncEnabled: true,
      alertingEnabled: true,
      metricsCollectionEnabled: true,
      enhancedLoggingEnabled: false,
      debugModeEnabled: false
    };
    
    const results = featureFlagService.updateFlags(
      defaultFlags,
      reason || `Reset to defaults by ${req.ip}`
    );
    
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    res.json({
      success: failed === 0,
      data: {
        reset: successful,
        failed,
        results
      }
    });
  } catch (error) {
    structuredLogger.error('Failed to reset feature flags', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to reset feature flags'
    });
  }
});

export default router;