import express from 'express';
import featureFlagService from '../services/featureFlagService.js';
import { WhatsAppServiceFactory } from '../services/whatsappServiceFactory.js';
import { structuredLogger } from '../helpers/logger.js';

const router = express.Router();

/**
 * Get migration status and configuration
 */
router.get('/status', async (req, res) => {
  try {
    const migrationStatus = featureFlagService.getMigrationStatus();
    const allFlags = featureFlagService.getAllFlags();
    
    res.json({
      success: true,
      data: {
        ...migrationStatus,
        featureFlags: {
          whatsappCloudApiEnabled: allFlags.whatsappCloudApiEnabled,
          whatsappCloudApiMigrationMode: allFlags.whatsappCloudApiMigrationMode
        },
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    structuredLogger.error('Failed to get migration status', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get migration status',
      details: error.message
    });
  }
});

/**
 * Start migration process
 */
router.post('/start', async (req, res) => {
  try {
    const { initialPercentage = 5, reason = 'Migration started via API' } = req.body;
    
    if (typeof initialPercentage !== 'number' || initialPercentage < 0 || initialPercentage > 100) {
      return res.status(400).json({
        success: false,
        error: 'Initial percentage must be a number between 0 and 100'
      });
    }
    
    const result = featureFlagService.startMigration(initialPercentage, reason);
    
    if (result.success) {
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    structuredLogger.error('Failed to start migration', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to start migration',
      details: error.message
    });
  }
});

/**
 * Update migration traffic percentage
 */
router.put('/traffic', async (req, res) => {
  try {
    const { percentage, reason = 'Traffic percentage updated via API' } = req.body;
    
    if (typeof percentage !== 'number' || percentage < 0 || percentage > 100) {
      return res.status(400).json({
        success: false,
        error: 'Percentage must be a number between 0 and 100'
      });
    }
    
    const result = featureFlagService.updateMigrationTrafficPercentage(percentage, reason);
    
    if (result.success) {
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    structuredLogger.error('Failed to update traffic percentage', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update traffic percentage',
      details: error.message
    });
  }
});

/**
 * Complete migration process
 */
router.post('/complete', async (req, res) => {
  try {
    const { reason = 'Migration completed via API' } = req.body;
    
    const result = featureFlagService.completeMigration(reason);
    
    if (result.success) {
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    structuredLogger.error('Failed to complete migration', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to complete migration',
      details: error.message
    });
  }
});

/**
 * Rollback migration process
 */
router.post('/rollback', async (req, res) => {
  try {
    const { reason = 'Migration rolled back via API' } = req.body;
    
    const result = featureFlagService.rollbackMigration(reason);
    
    if (result.success) {
      res.json({
        success: true,
        data: result,
        timestamp: new Date().toISOString()
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error
      });
    }
  } catch (error) {
    structuredLogger.error('Failed to rollback migration', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to rollback migration',
      details: error.message
    });
  }
});

/**
 * Get routing statistics for a set of user IDs
 */
router.post('/routing-stats', async (req, res) => {
  try {
    const { userIds = [], sampleSize = 1000 } = req.body;
    
    let testUserIds = userIds;
    
    // Generate sample user IDs if none provided
    if (testUserIds.length === 0) {
      testUserIds = Array.from({ length: sampleSize }, (_, i) => `user_${i}`);
    }
    
    const factory = WhatsAppServiceFactory.getInstance();
    const stats = factory.getRoutingStatistics(testUserIds);
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to get routing statistics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get routing statistics',
      details: error.message
    });
  }
});

/**
 * Get migration health check
 */
router.get('/health', async (req, res) => {
  try {
    const migrationStatus = featureFlagService.getMigrationStatus();
    const flagHealth = featureFlagService.getHealthCheck();
    
    // Check service availability
    const factory = WhatsAppServiceFactory.getInstance();
    const registeredProviders = factory.getRegisteredProviders();
    
    const health = {
      migration: migrationStatus,
      featureFlags: flagHealth,
      providers: {
        registered: registeredProviders,
        twilioAvailable: factory.isProviderRegistered('twilio'),
        cloudApiAvailable: factory.isProviderRegistered('cloud-api')
      },
      timestamp: new Date().toISOString()
    };
    
    // Determine overall health status
    let status = 'healthy';
    const issues = [];
    
    if (flagHealth.issues.length > 0) {
      status = 'warning';
      issues.push(...flagHealth.issues);
    }
    
    if (!health.providers.twilioAvailable && !health.providers.cloudApiAvailable) {
      status = 'unhealthy';
      issues.push({
        component: 'providers',
        issue: 'No WhatsApp service providers available',
        severity: 'critical'
      });
    }
    
    if (migrationStatus.migrationMode && migrationStatus.trafficPercentage > 0 && !health.providers.cloudApiAvailable) {
      status = 'unhealthy';
      issues.push({
        component: 'migration',
        issue: 'Migration mode active but Cloud API provider not available',
        severity: 'critical'
      });
    }
    
    res.json({
      success: true,
      data: {
        status,
        issues,
        ...health
      }
    });
  } catch (error) {
    structuredLogger.error('Failed to get migration health', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get migration health',
      details: error.message
    });
  }
});

/**
 * Get migration configuration
 */
router.get('/config', async (req, res) => {
  try {
    const config = {
      trafficPercentage: featureFlagService.getMigrationTrafficPercentage(),
      migrationStatus: featureFlagService.getMigrationStatus(),
      featureFlags: featureFlagService.getAllFlags(),
      timestamp: new Date().toISOString()
    };
    
    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    structuredLogger.error('Failed to get migration config', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get migration config',
      details: error.message
    });
  }
});

/**
 * Bulk update feature flags
 */
router.put('/flags', async (req, res) => {
  try {
    const { flags, reason = 'Bulk flag update via API' } = req.body;
    
    if (!flags || typeof flags !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Flags object is required'
      });
    }
    
    const results = featureFlagService.updateFlags(flags, reason);
    const successful = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    
    res.json({
      success: failed === 0,
      data: {
        updated: successful,
        failed,
        results,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    structuredLogger.error('Failed to update feature flags', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to update feature flags',
      details: error.message
    });
  }
});

/**
 * Get migration progress and monitoring data
 */
router.get('/progress', async (req, res) => {
  try {
    const migrationMonitoringService = (await import('../services/migrationMonitoringService.js')).default;
    const progress = migrationMonitoringService.getMigrationProgress();
    
    res.json({
      success: true,
      data: progress,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to get migration progress', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get migration progress',
      details: error.message
    });
  }
});

/**
 * Perform side-by-side comparison
 */
router.post('/compare', async (req, res) => {
  try {
    const { messageData, sampleSize = 10 } = req.body;
    
    if (!messageData) {
      return res.status(400).json({
        success: false,
        error: 'Message data is required for comparison'
      });
    }
    
    const migrationMonitoringService = (await import('../services/migrationMonitoringService.js')).default;
    const result = await migrationMonitoringService.performSideBySideComparison(messageData, sampleSize);
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to perform side-by-side comparison', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to perform comparison',
      details: error.message
    });
  }
});

/**
 * Validate message delivery
 */
router.post('/validate-delivery', async (req, res) => {
  try {
    const { messageIds, provider } = req.body;
    
    if (!messageIds || !Array.isArray(messageIds) || messageIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message IDs array is required'
      });
    }
    
    if (!provider || !['twilio', 'cloud-api'].includes(provider)) {
      return res.status(400).json({
        success: false,
        error: 'Valid provider (twilio or cloud-api) is required'
      });
    }
    
    const migrationMonitoringService = (await import('../services/migrationMonitoringService.js')).default;
    const result = await migrationMonitoringService.validateMessageDelivery(messageIds, provider);
    
    res.json({
      success: true,
      data: result,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to validate message delivery', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to validate message delivery',
      details: error.message
    });
  }
});

/**
 * Start migration monitoring
 */
router.post('/monitoring/start', async (req, res) => {
  try {
    const migrationMonitoringService = (await import('../services/migrationMonitoringService.js')).default;
    migrationMonitoringService.startMonitoring();
    
    res.json({
      success: true,
      message: 'Migration monitoring started',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to start migration monitoring', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to start monitoring',
      details: error.message
    });
  }
});

/**
 * Stop migration monitoring
 */
router.post('/monitoring/stop', async (req, res) => {
  try {
    const migrationMonitoringService = (await import('../services/migrationMonitoringService.js')).default;
    migrationMonitoringService.stopMonitoring();
    
    res.json({
      success: true,
      message: 'Migration monitoring stopped',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to stop migration monitoring', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to stop monitoring',
      details: error.message
    });
  }
});

/**
 * Reset migration metrics
 */
router.post('/monitoring/reset', async (req, res) => {
  try {
    const migrationMonitoringService = (await import('../services/migrationMonitoringService.js')).default;
    migrationMonitoringService.resetMetrics();
    
    res.json({
      success: true,
      message: 'Migration metrics reset',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to reset migration metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to reset metrics',
      details: error.message
    });
  }
});

/**
 * Export migration metrics
 */
router.get('/monitoring/export', async (req, res) => {
  try {
    const migrationMonitoringService = (await import('../services/migrationMonitoringService.js')).default;
    const exportData = migrationMonitoringService.exportMetrics();
    
    res.json({
      success: true,
      data: exportData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    structuredLogger.error('Failed to export migration metrics', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to export metrics',
      details: error.message
    });
  }
});

/**
 * Serve migration dashboard
 */
router.get('/dashboard', (req, res) => {
  res.sendFile('migration-dashboard.html', { root: 'src/views' });
});

export default router;