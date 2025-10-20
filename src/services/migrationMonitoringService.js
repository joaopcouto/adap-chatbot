import { structuredLogger } from '../helpers/logger.js';
import { WhatsAppServiceFactory } from './whatsappServiceFactory.js';
import featureFlagService from './featureFlagService.js';
import configManager from '../config/config.js';

/**
 * Migration Monitoring Service for tracking and validating migration progress
 */
class MigrationMonitoringService {
  constructor() {
    this.factory = WhatsAppServiceFactory.getInstance();
    this.metrics = {
      totalMessages: 0,
      // twilioMessages: deprecated,
      cloudApiMessages: 0,
      // twilioSuccesses: deprecated,
      cloudApiSuccesses: 0,
      // twilioErrors: deprecated,
      cloudApiErrors: 0,
      comparisonResults: [],
      lastReset: new Date()
    };
    this.validationQueue = [];
    this.isMonitoring = false;
    this.monitoringInterval = null;
  }

  /**
   * Start monitoring migration metrics
   */
  startMonitoring() {
    if (this.isMonitoring) {
      structuredLogger.warn('Migration monitoring is already running');
      return;
    }

    this.isMonitoring = true;
    const intervalMs = configManager.get('migration.migrationMonitoringInterval', 60000);
    
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
      this.checkRollbackConditions();
    }, intervalMs);

    structuredLogger.info('Migration monitoring started', {
      intervalMs,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Stop monitoring migration metrics
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      return;
    }

    this.isMonitoring = false;
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    structuredLogger.info('Migration monitoring stopped', {
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Record message sending attempt
   */
  recordMessageAttempt(provider, success, error = null, metadata = {}) {
    this.metrics.totalMessages++;
    
    if (provider === 'twilio') {
        // Twilio provider is deprecated and no longer supported
        console.warn('Twilio provider is deprecated. Please use cloud-api provider.');
        return;
      } else {
        this.metrics.twilioErrors++;
      }
    } else if (provider === 'cloud-api') {
      this.metrics.cloudApiMessages++;
      if (success) {
        this.metrics.cloudApiSuccesses++;
      } else {
        this.metrics.cloudApiErrors++;
      }
    }

    // Log detailed metrics
    structuredLogger.info('Message attempt recorded', {
      provider,
      success,
      error: error?.message,
      metadata,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Perform side-by-side comparison of both services
   */
  async performSideBySideComparison(messageData, sampleSize = 10) {
    if (!featureFlagService.isEnabled('whatsappCloudApiMigrationMode')) {
      throw new Error('Migration mode must be enabled for side-by-side comparison');
    }

    const results = {
      timestamp: new Date().toISOString(),
      sampleSize,
      // twilioResults: deprecated,
      cloudApiResults: [],
      comparison: {
        successRates: {},
        averageResponseTimes: {},
        errorTypes: {},
        deliveryRates: {}
      }
    };

    try {
      // Create both service instances
      const twilioService = this.factory.createService({ provider: 'twilio', testMode: true });
      const cloudApiService = this.factory.createService({ provider: 'cloud-api', testMode: true });

      // Perform parallel tests
      const twilioPromises = [];
      const cloudApiPromises = [];

      for (let i = 0; i < sampleSize; i++) {
        const testMessage = {
          ...messageData,
          to: messageData.to || `+5511999${String(i).padStart(6, '0')}`, // Test phone numbers
          body: `${messageData.body || 'Test message'} - Sample ${i + 1}`
        };

        twilioPromises.push(this.testMessageSending(twilioService, 'twilio', testMessage));
        cloudApiPromises.push(this.testMessageSending(cloudApiService, 'cloud-api', testMessage));
      }

      // Wait for all tests to complete
      results.twilioResults = await Promise.allSettled(twilioPromises);
      results.cloudApiResults = await Promise.allSettled(cloudApiPromises);

      // Analyze results
      results.comparison = this.analyzeComparisonResults(results.twilioResults, results.cloudApiResults);

      // Store results for historical tracking
      this.metrics.comparisonResults.push(results);

      // Keep only last 100 comparison results
      if (this.metrics.comparisonResults.length > 100) {
        this.metrics.comparisonResults = this.metrics.comparisonResults.slice(-100);
      }

      structuredLogger.info('Side-by-side comparison completed', {
        sampleSize,
        twilioSuccessRate: results.comparison.successRates.twilio,
        cloudApiSuccessRate: results.comparison.successRates.cloudApi,
        timestamp: results.timestamp
      });

      return results;
    } catch (error) {
      structuredLogger.error('Side-by-side comparison failed', {
        error: error.message,
        sampleSize,
        timestamp: new Date().toISOString()
      });
      throw error;
    }
  }

  /**
   * Test message sending with a specific service
   */
  async testMessageSending(service, provider, messageData) {
    const startTime = Date.now();
    
    try {
      let result;
      
      if (messageData.type === 'template') {
        result = await service.sendTemplateMessage(
          messageData.to,
          messageData.templateId,
          messageData.variables || {}
        );
      } else if (messageData.type === 'media') {
        result = await service.sendMediaMessage(
          messageData.to,
          messageData.mediaUrl,
          messageData.caption
        );
      } else {
        result = await service.sendTextMessage(messageData.to, messageData.body);
      }

      const responseTime = Date.now() - startTime;

      return {
        provider,
        success: true,
        responseTime,
        messageId: result.messageId,
        status: result.status,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      return {
        provider,
        success: false,
        responseTime,
        error: {
          message: error.message,
          code: error.code,
          type: error.constructor.name
        },
        timestamp: new Date().toISOString()
      };
    }
  }

  /**
   * Analyze comparison results
   */
  analyzeComparisonResults(twilioResults, cloudApiResults) {
    const analysis = {
      successRates: {},
      averageResponseTimes: {},
      errorTypes: {},
      deliveryRates: {}
    };

    // Calculate success rates
    const twilioSuccesses = twilioResults.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const cloudApiSuccesses = cloudApiResults.filter(r => r.status === 'fulfilled' && r.value.success).length;

    analysis.successRates.twilio = (twilioSuccesses / twilioResults.length) * 100;
    analysis.successRates.cloudApi = (cloudApiSuccesses / cloudApiResults.length) * 100;

    // Calculate average response times
    const twilioTimes = twilioResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.responseTime);
    const cloudApiTimes = cloudApiResults
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value.responseTime);

    analysis.averageResponseTimes.twilio = twilioTimes.length > 0 
      ? twilioTimes.reduce((a, b) => a + b, 0) / twilioTimes.length 
      : 0;
    analysis.averageResponseTimes.cloudApi = cloudApiTimes.length > 0 
      ? cloudApiTimes.reduce((a, b) => a + b, 0) / cloudApiTimes.length 
      : 0;

    // Analyze error types
    const twilioErrors = twilioResults
      .filter(r => r.status === 'fulfilled' && !r.value.success)
      .map(r => r.value.error?.type || 'Unknown');
    const cloudApiErrors = cloudApiResults
      .filter(r => r.status === 'fulfilled' && !r.value.success)
      .map(r => r.value.error?.type || 'Unknown');

    analysis.errorTypes.twilio = this.countErrorTypes(twilioErrors);
    analysis.errorTypes.cloudApi = this.countErrorTypes(cloudApiErrors);

    return analysis;
  }

  /**
   * Count error types
   */
  countErrorTypes(errors) {
    const counts = {};
    for (const error of errors) {
      counts[error] = (counts[error] || 0) + 1;
    }
    return counts;
  }

  /**
   * Validate message delivery
   */
  async validateMessageDelivery(messageIds, provider) {
    const validationResults = {
      timestamp: new Date().toISOString(),
      provider,
      messageIds,
      results: [],
      summary: {
        total: messageIds.length,
        delivered: 0,
        failed: 0,
        pending: 0,
        unknown: 0
      }
    };

    try {
      const service = this.factory.createService({ provider });
      
      for (const messageId of messageIds) {
        try {
          // Note: This would require implementing a getMessageStatus method in the services
          // For now, we'll simulate the validation
          const status = await this.simulateMessageStatusCheck(messageId, provider);
          
          validationResults.results.push({
            messageId,
            status: status.status,
            deliveredAt: status.deliveredAt,
            error: status.error
          });

          validationResults.summary[status.status]++;
        } catch (error) {
          validationResults.results.push({
            messageId,
            status: 'unknown',
            error: error.message
          });
          validationResults.summary.unknown++;
        }
      }

      structuredLogger.info('Message delivery validation completed', {
        provider,
        total: validationResults.summary.total,
        delivered: validationResults.summary.delivered,
        failed: validationResults.summary.failed
      });

      return validationResults;
    } catch (error) {
      structuredLogger.error('Message delivery validation failed', {
        provider,
        error: error.message
      });
      throw error;
    }
  }

  /**
   * Simulate message status check (placeholder for actual implementation)
   */
  async simulateMessageStatusCheck(messageId, provider) {
    // In a real implementation, this would call the provider's API to check message status
    // For now, we'll simulate different statuses
    const statuses = ['delivered', 'failed', 'pending'];
    const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
    
    return {
      status: randomStatus,
      deliveredAt: randomStatus === 'delivered' ? new Date().toISOString() : null,
      error: randomStatus === 'failed' ? 'Simulated delivery failure' : null
    };
  }

  /**
   * Get migration progress tracking
   */
  getMigrationProgress() {
    const migrationStatus = featureFlagService.getMigrationStatus();
    const currentMetrics = this.getCurrentMetrics();
    
    return {
      status: migrationStatus.status,
      trafficPercentage: migrationStatus.trafficPercentage,
      metrics: currentMetrics,
      health: this.getHealthStatus(),
      recommendations: this.getRecommendations(),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Get current metrics
   */
  getCurrentMetrics() {
    const twilioSuccessRate = this.metrics.twilioMessages > 0 
      ? (this.metrics.twilioSuccesses / this.metrics.twilioMessages) * 100 
      : 0;
    const cloudApiSuccessRate = this.metrics.cloudApiMessages > 0 
      ? (this.metrics.cloudApiSuccesses / this.metrics.cloudApiMessages) * 100 
      : 0;

    return {
      ...this.metrics,
      successRates: {
        twilio: twilioSuccessRate,
        cloudApi: cloudApiSuccessRate
      },
      errorRates: {
        twilio: this.metrics.twilioMessages > 0 
          ? (this.metrics.twilioErrors / this.metrics.twilioMessages) * 100 
          : 0,
        cloudApi: this.metrics.cloudApiMessages > 0 
          ? (this.metrics.cloudApiErrors / this.metrics.cloudApiMessages) * 100 
          : 0
      }
    };
  }

  /**
   * Get health status
   */
  getHealthStatus() {
    const metrics = this.getCurrentMetrics();
    const rollbackThreshold = configManager.get('migration.migrationRollbackThreshold', 0.05) * 100;
    
    let status = 'healthy';
    const issues = [];

    // Check error rates
    if (metrics.errorRates.cloudApi > rollbackThreshold) {
      status = 'unhealthy';
      issues.push({
        type: 'high_error_rate',
        severity: 'critical',
        message: `Cloud API error rate (${metrics.errorRates.cloudApi.toFixed(2)}%) exceeds threshold (${rollbackThreshold}%)`
      });
    }

    // Check if Cloud API is performing worse than Twilio
    if (metrics.errorRates.cloudApi > metrics.errorRates.twilio + 5) {
      status = status === 'healthy' ? 'warning' : status;
      issues.push({
        type: 'performance_degradation',
        severity: 'warning',
        message: `Cloud API error rate is significantly higher than Twilio`
      });
    }

    // Check for recent comparison results
    const recentComparisons = this.metrics.comparisonResults.slice(-5);
    if (recentComparisons.length > 0) {
      const avgCloudApiSuccess = recentComparisons.reduce((sum, r) => 
        sum + r.comparison.successRates.cloudApi, 0) / recentComparisons.length;
      
      if (avgCloudApiSuccess < 95) {
        status = status === 'healthy' ? 'warning' : status;
        issues.push({
          type: 'low_success_rate',
          severity: 'warning',
          message: `Average Cloud API success rate (${avgCloudApiSuccess.toFixed(2)}%) is below 95%`
        });
      }
    }

    return {
      status,
      issues,
      lastCheck: new Date().toISOString()
    };
  }

  /**
   * Get recommendations based on current metrics
   */
  getRecommendations() {
    const metrics = this.getCurrentMetrics();
    const health = this.getHealthStatus();
    const recommendations = [];

    if (health.status === 'unhealthy') {
      recommendations.push({
        type: 'rollback',
        priority: 'high',
        message: 'Consider rolling back migration due to high error rates'
      });
    }

    if (metrics.errorRates.cloudApi > metrics.errorRates.twilio + 2) {
      recommendations.push({
        type: 'investigate',
        priority: 'medium',
        message: 'Investigate Cloud API configuration and error patterns'
      });
    }

    if (metrics.totalMessages < 100) {
      recommendations.push({
        type: 'increase_traffic',
        priority: 'low',
        message: 'Consider increasing traffic percentage to gather more data'
      });
    }

    const migrationStatus = featureFlagService.getMigrationStatus();
    if (migrationStatus.trafficPercentage === 100 && health.status === 'healthy') {
      recommendations.push({
        type: 'complete_migration',
        priority: 'high',
        message: 'Migration is ready to be completed'
      });
    }

    return recommendations;
  }

  /**
   * Check rollback conditions
   */
  checkRollbackConditions() {
    const health = this.getHealthStatus();
    const rollbackThreshold = configManager.get('migration.migrationRollbackThreshold', 0.05) * 100;

    if (health.status === 'unhealthy') {
      const criticalIssues = health.issues.filter(i => i.severity === 'critical');
      
      if (criticalIssues.length > 0) {
        structuredLogger.warn('Critical migration issues detected', {
          issues: criticalIssues,
          rollbackThreshold,
          timestamp: new Date().toISOString()
        });

        // In a production system, you might want to automatically trigger rollback
        // For now, we'll just log the recommendation
        structuredLogger.warn('Automatic rollback recommended', {
          reason: 'Critical migration issues detected',
          issues: criticalIssues
        });
      }
    }
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.metrics = {
      totalMessages: 0,
      // twilioMessages: deprecated,
      cloudApiMessages: 0,
      // twilioSuccesses: deprecated,
      cloudApiSuccesses: 0,
      // twilioErrors: deprecated,
      cloudApiErrors: 0,
      comparisonResults: [],
      lastReset: new Date()
    };

    structuredLogger.info('Migration metrics reset', {
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Export metrics for analysis
   */
  exportMetrics() {
    return {
      metrics: this.getCurrentMetrics(),
      comparisonResults: this.metrics.comparisonResults,
      health: this.getHealthStatus(),
      recommendations: this.getRecommendations(),
      exportedAt: new Date().toISOString()
    };
  }
}

// Create singleton instance
const migrationMonitoringService = new MigrationMonitoringService();

export default migrationMonitoringService;
export { MigrationMonitoringService };