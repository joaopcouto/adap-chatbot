import express from 'express';
import { 
  getSyncRetryJobMetrics, 
  getSyncRetryJobHealth, 
  forceSyncRetryRun 
} from '../jobs/syncRetryJob.js';
import {
  getAlertingJobMetrics,
  getAlertingJobHealth,
  forceAlertingRun
} from '../jobs/alertingJob.js';
import ReminderSync from '../models/ReminderSync.js';
import UserGoogleIntegration from '../models/UserGoogleIntegration.js';
import metricsCollector from '../services/metricsCollector.js';
import alertingService from '../services/alertingService.js';
import { devLog } from '../helpers/logger.js';
import { structuredLogger, generateCorrelationId } from '../helpers/logger.js';

const router = express.Router();

/**
 * Get sync retry job metrics
 * GET /api/monitoring/sync-retry/metrics
 */
router.get('/sync-retry/metrics', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Fetching sync retry job metrics', {
      correlationId,
      requestedBy: req.ip
    });
    
    const metrics = getSyncRetryJobMetrics();
    
    res.json({
      success: true,
      data: metrics,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching sync retry job metrics', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch metrics',
      correlationId
    });
  }
});

/**
 * Get sync retry job health status
 * GET /api/monitoring/sync-retry/health
 */
router.get('/sync-retry/health', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Fetching sync retry job health status', {
      correlationId,
      requestedBy: req.ip
    });
    
    const health = await getSyncRetryJobHealth();
    
    // Set appropriate HTTP status based on health
    const httpStatus = health.status === 'healthy' ? 200 :
                      health.status === 'warning' ? 200 :
                      health.status === 'critical' ? 503 : 500;
    
    res.status(httpStatus).json({
      success: true,
      data: health,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching sync retry job health', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch health status',
      correlationId
    });
  }
});

/**
 * Get detailed sync queue statistics
 * GET /api/monitoring/sync-retry/queue-stats
 */
router.get('/sync-retry/queue-stats', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Fetching sync queue statistics', {
      correlationId,
      requestedBy: req.ip
    });
    
    // Get various queue statistics
    const [
      totalRecords,
      queuedCount,
      okCount,
      failedCount,
      retryableFailedCount,
      permanentFailedCount,
      oldFailedCount
    ] = await Promise.all([
      ReminderSync.countDocuments(),
      ReminderSync.countDocuments({ syncStatus: 'QUEUED' }),
      ReminderSync.countDocuments({ syncStatus: 'OK' }),
      ReminderSync.countDocuments({ syncStatus: 'FAILED' }),
      ReminderSync.countDocuments({ 
        syncStatus: 'FAILED', 
        retryCount: { $lt: 3 } 
      }),
      ReminderSync.countDocuments({ 
        syncStatus: 'FAILED', 
        retryCount: { $gte: 3 } 
      }),
      ReminderSync.countDocuments({
        syncStatus: 'FAILED',
        updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      })
    ]);
    
    // Get recent activity (last 24 hours)
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recentActivity = await ReminderSync.aggregate([
      {
        $match: {
          updatedAt: { $gte: last24Hours }
        }
      },
      {
        $group: {
          _id: '$syncStatus',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const stats = {
      total: {
        records: totalRecords,
        queued: queuedCount,
        successful: okCount,
        failed: failedCount,
        retryable: retryableFailedCount,
        permanentlyFailed: permanentFailedCount,
        oldFailed: oldFailedCount
      },
      recent24Hours: recentActivity.reduce((acc, item) => {
        acc[item._id.toLowerCase()] = item.count;
        return acc;
      }, {}),
      percentages: {
        successRate: totalRecords > 0 ? ((okCount / totalRecords) * 100).toFixed(2) : 0,
        failureRate: totalRecords > 0 ? ((failedCount / totalRecords) * 100).toFixed(2) : 0,
        retryableRate: failedCount > 0 ? ((retryableFailedCount / failedCount) * 100).toFixed(2) : 0
      }
    };
    
    res.json({
      success: true,
      data: stats,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching sync queue statistics', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch queue statistics',
      correlationId
    });
  }
});

/**
 * Force run the sync retry job (manual trigger)
 * POST /api/monitoring/sync-retry/force-run
 */
router.post('/sync-retry/force-run', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Manual sync retry job trigger requested', {
      correlationId,
      requestedBy: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    // Start the job asynchronously
    forceSyncRetryRun().catch(error => {
      structuredLogger.error('Error in manually triggered sync retry job', {
        correlationId,
        error
      });
    });
    
    res.json({
      success: true,
      message: 'Sync retry job triggered successfully',
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error triggering manual sync retry job', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to trigger sync retry job',
      correlationId
    });
  }
});

/**
 * Get failed sync records with details (for debugging)
 * GET /api/monitoring/sync-retry/failed-records
 */
router.get('/sync-retry/failed-records', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100); // Max 100 records
    const skip = (page - 1) * limit;
    
    structuredLogger.info('Fetching failed sync records', {
      correlationId,
      page,
      limit,
      requestedBy: req.ip
    });
    
    const [records, totalCount] = await Promise.all([
      ReminderSync.find({ syncStatus: 'FAILED' })
        .sort({ updatedAt: -1 })
        .skip(skip)
        .limit(limit)
        .select('messageId userId syncStatus lastError lastTriedAt retryCount maxRetries createdAt updatedAt'),
      ReminderSync.countDocuments({ syncStatus: 'FAILED' })
    ]);
    
    res.json({
      success: true,
      data: {
        records,
        pagination: {
          page,
          limit,
          totalCount,
          totalPages: Math.ceil(totalCount / limit),
          hasNext: page * limit < totalCount,
          hasPrev: page > 1
        }
      },
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching failed sync records', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch failed records',
      correlationId
    });
  }
});

/**
 * Get comprehensive Google Calendar integration metrics
 * GET /api/monitoring/google-calendar/metrics
 */
router.get('/google-calendar/metrics', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Fetching Google Calendar integration metrics', {
      correlationId,
      requestedBy: req.ip
    });
    
    // Get metrics from the metrics collector
    const metrics = metricsCollector.getMetricsSummary();
    
    // Get additional database metrics
    const [
      totalIntegrations,
      activeIntegrations,
      totalSyncRecords,
      recentSyncActivity
    ] = await Promise.all([
      UserGoogleIntegration.countDocuments(),
      UserGoogleIntegration.countDocuments({ 
        connected: true, 
        calendarSyncEnabled: true 
      }),
      ReminderSync.countDocuments(),
      ReminderSync.aggregate([
        {
          $match: {
            updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }
          }
        },
        {
          $group: {
            _id: '$syncStatus',
            count: { $sum: 1 }
          }
        }
      ])
    ]);
    
    // Enhance metrics with database data
    const enhancedMetrics = {
      ...metrics,
      integrationMetrics: {
        totalIntegrations,
        activeIntegrations,
        integrationRate: totalIntegrations > 0 ? 
          (activeIntegrations / totalIntegrations) * 100 : 0
      },
      databaseMetrics: {
        totalSyncRecords,
        recentActivity: recentSyncActivity.reduce((acc, item) => {
          acc[item._id.toLowerCase()] = item.count;
          return acc;
        }, {})
      }
    };
    
    res.json({
      success: true,
      data: enhancedMetrics,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching Google Calendar metrics', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch Google Calendar metrics',
      correlationId
    });
  }
});

/**
 * Get sync success rate metrics with time-based breakdown
 * GET /api/monitoring/google-calendar/success-rate
 */
router.get('/google-calendar/success-rate', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    const timeRange = req.query.range || '24h'; // 1h, 24h, 7d, 30d
    let timeRangeMs;
    
    switch (timeRange) {
      case '1h':
        timeRangeMs = 60 * 60 * 1000;
        break;
      case '24h':
        timeRangeMs = 24 * 60 * 60 * 1000;
        break;
      case '7d':
        timeRangeMs = 7 * 24 * 60 * 60 * 1000;
        break;
      case '30d':
        timeRangeMs = 30 * 24 * 60 * 60 * 1000;
        break;
      default:
        timeRangeMs = 24 * 60 * 60 * 1000;
    }
    
    const cutoffTime = new Date(Date.now() - timeRangeMs);
    
    structuredLogger.info('Fetching sync success rate metrics', {
      correlationId,
      timeRange,
      cutoffTime,
      requestedBy: req.ip
    });
    
    // Get sync statistics for the time range
    const [syncStats, errorBreakdown] = await Promise.all([
      ReminderSync.aggregate([
        {
          $match: {
            updatedAt: { $gte: cutoffTime }
          }
        },
        {
          $group: {
            _id: '$syncStatus',
            count: { $sum: 1 }
          }
        }
      ]),
      ReminderSync.aggregate([
        {
          $match: {
            syncStatus: 'FAILED',
            updatedAt: { $gte: cutoffTime }
          }
        },
        {
          $group: {
            _id: {
              $regexFind: {
                input: '$lastError',
                regex: /(AUTH_ERROR|RATE_LIMIT|SERVER_ERROR|CLIENT_ERROR|NETWORK_ERROR)/
              }
            },
            count: { $sum: 1 }
          }
        }
      ])
    ]);
    
    // Calculate success rate
    const totalOperations = syncStats.reduce((sum, stat) => sum + stat.count, 0);
    const successfulOperations = syncStats.find(stat => stat._id === 'OK')?.count || 0;
    const failedOperations = syncStats.find(stat => stat._id === 'FAILED')?.count || 0;
    const queuedOperations = syncStats.find(stat => stat._id === 'QUEUED')?.count || 0;
    
    const successRate = totalOperations > 0 ? (successfulOperations / totalOperations) * 100 : 100;
    const failureRate = totalOperations > 0 ? (failedOperations / totalOperations) * 100 : 0;
    
    // Process error breakdown
    const errorDistribution = errorBreakdown.reduce((acc, error) => {
      const errorType = error._id?.match || 'UNKNOWN_ERROR';
      acc[errorType] = error.count;
      return acc;
    }, {});
    
    const successRateData = {
      timeRange,
      totalOperations,
      successfulOperations,
      failedOperations,
      queuedOperations,
      successRate: Math.round(successRate * 100) / 100,
      failureRate: Math.round(failureRate * 100) / 100,
      errorDistribution,
      // Get current in-memory metrics for comparison
      currentMetrics: {
        successRate: metricsCollector.getSyncSuccessRate(),
        failureRate: metricsCollector.getSyncFailureRate(),
        totalOperations: metricsCollector.metrics.syncOperations.total
      }
    };
    
    res.json({
      success: true,
      data: successRateData,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching sync success rate metrics', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch success rate metrics',
      correlationId
    });
  }
});

/**
 * Get API response time metrics and performance data
 * GET /api/monitoring/google-calendar/performance
 */
router.get('/google-calendar/performance', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Fetching Google Calendar performance metrics', {
      correlationId,
      requestedBy: req.ip
    });
    
    const metrics = metricsCollector.getMetricsSummary();
    
    // Get slow operations from database (operations that took longer than 5 seconds)
    const slowOperations = await ReminderSync.find({
      updatedAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      lastError: { $regex: /duration|timeout|slow/i }
    })
    .sort({ updatedAt: -1 })
    .limit(10)
    .select('messageId userId lastError lastTriedAt syncStatus');
    
    const performanceData = {
      responseTimeMetrics: metrics.responseTimeMetrics,
      performanceHealth: metrics.healthIndicators.performanceHealth,
      slowOperations: slowOperations.map(op => ({
        messageId: op.messageId,
        userId: op.userId,
        error: op.lastError,
        timestamp: op.lastTriedAt,
        status: op.syncStatus
      })),
      thresholds: {
        slowOperationThreshold: 5000, // 5 seconds
        warningThreshold: 2000, // 2 seconds
        criticalThreshold: 10000 // 10 seconds
      }
    };
    
    res.json({
      success: true,
      data: performanceData,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching performance metrics', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance metrics',
      correlationId
    });
  }
});

/**
 * Get error distribution and authentication issue metrics
 * GET /api/monitoring/google-calendar/errors
 */
router.get('/google-calendar/errors', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    const timeRange = req.query.range || '24h';
    let timeRangeMs;
    
    switch (timeRange) {
      case '1h':
        timeRangeMs = 60 * 60 * 1000;
        break;
      case '24h':
        timeRangeMs = 24 * 60 * 60 * 1000;
        break;
      case '7d':
        timeRangeMs = 7 * 24 * 60 * 60 * 1000;
        break;
      default:
        timeRangeMs = 24 * 60 * 60 * 1000;
    }
    
    const cutoffTime = new Date(Date.now() - timeRangeMs);
    
    structuredLogger.info('Fetching error distribution metrics', {
      correlationId,
      timeRange,
      cutoffTime,
      requestedBy: req.ip
    });
    
    // Get error patterns from database
    const [errorPatterns, authErrors, disconnectedUsers] = await Promise.all([
      ReminderSync.aggregate([
        {
          $match: {
            syncStatus: 'FAILED',
            updatedAt: { $gte: cutoffTime }
          }
        },
        {
          $group: {
            _id: '$lastError',
            count: { $sum: 1 },
            latestOccurrence: { $max: '$updatedAt' },
            affectedUsers: { $addToSet: '$userId' }
          }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 20
        }
      ]),
      ReminderSync.countDocuments({
        syncStatus: 'FAILED',
        lastError: { $regex: /(auth|token|credential|permission)/i },
        updatedAt: { $gte: cutoffTime }
      }),
      UserGoogleIntegration.countDocuments({
        connected: false,
        updatedAt: { $gte: cutoffTime }
      })
    ]);
    
    const metrics = metricsCollector.getMetricsSummary();
    
    const errorData = {
      timeRange,
      // In-memory error distribution
      errorDistribution: metrics.errorDistribution,
      // Authentication metrics
      authenticationMetrics: {
        ...metrics.authenticationMetrics,
        recentAuthErrors: authErrors,
        recentDisconnections: disconnectedUsers
      },
      // Top error patterns from database
      topErrorPatterns: errorPatterns.map(pattern => ({
        error: pattern._id,
        count: pattern.count,
        latestOccurrence: pattern.latestOccurrence,
        affectedUserCount: pattern.affectedUsers.length
      })),
      // Health indicators
      healthIndicators: {
        authHealth: metrics.healthIndicators.authHealth,
        syncHealth: metrics.healthIndicators.syncHealth
      }
    };
    
    res.json({
      success: true,
      data: errorData,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching error distribution metrics', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch error metrics',
      correlationId
    });
  }
});

/**
 * Get comprehensive health check for Google Calendar integration
 * GET /api/monitoring/google-calendar/health
 */
router.get('/google-calendar/health', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Performing Google Calendar health check', {
      correlationId,
      requestedBy: req.ip
    });
    
    // Update queue metrics before health check
    await metricsCollector.updateQueueMetrics(null, correlationId);
    
    const metrics = metricsCollector.getMetricsSummary();
    const retryJobHealth = await getSyncRetryJobHealth();
    
    // Get additional health indicators
    const [
      stuckRecords,
      oldFailedRecords,
      activeIntegrations
    ] = await Promise.all([
      ReminderSync.countDocuments({
        syncStatus: 'QUEUED',
        createdAt: { $lt: new Date(Date.now() - 60 * 60 * 1000) } // Older than 1 hour
      }),
      ReminderSync.countDocuments({
        syncStatus: 'FAILED',
        retryCount: { $gte: 3 },
        updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) }
      }),
      UserGoogleIntegration.countDocuments({
        connected: true,
        calendarSyncEnabled: true
      })
    ]);
    
    // Calculate overall health score
    let healthScore = 100;
    const issues = [];
    
    // Check sync success rate
    const successRate = metrics.syncMetrics.successRate;
    if (successRate < 70) {
      healthScore -= 30;
      issues.push(`Low sync success rate: ${successRate.toFixed(1)}%`);
    } else if (successRate < 90) {
      healthScore -= 15;
      issues.push(`Moderate sync success rate: ${successRate.toFixed(1)}%`);
    }
    
    // Check queue size
    const queueSize = metrics.queueMetrics.currentSize;
    if (queueSize > 100) {
      healthScore -= 25;
      issues.push(`High queue size: ${queueSize} items`);
    } else if (queueSize > 50) {
      healthScore -= 10;
      issues.push(`Moderate queue size: ${queueSize} items`);
    }
    
    // Check authentication issues
    const authFailureRate = metrics.authenticationMetrics.authFailureRate;
    if (authFailureRate > 10) {
      healthScore -= 20;
      issues.push(`High auth failure rate: ${authFailureRate.toFixed(1)}%`);
    } else if (authFailureRate > 5) {
      healthScore -= 10;
      issues.push(`Moderate auth failure rate: ${authFailureRate.toFixed(1)}%`);
    }
    
    // Check for stuck records
    if (stuckRecords > 10) {
      healthScore -= 15;
      issues.push(`${stuckRecords} records stuck in QUEUED state`);
    }
    
    // Check for old failed records
    if (oldFailedRecords > 50) {
      healthScore -= 10;
      issues.push(`${oldFailedRecords} old failed records need cleanup`);
    }
    
    const overallStatus = healthScore >= 80 ? 'healthy' : 
                         healthScore >= 60 ? 'warning' : 'critical';
    
    const healthData = {
      overallStatus,
      healthScore: Math.max(0, healthScore),
      issues,
      components: {
        syncService: {
          status: metrics.healthIndicators.syncHealth,
          successRate: successRate,
          totalOperations: metrics.syncMetrics.totalOperations
        },
        authentication: {
          status: metrics.healthIndicators.authHealth,
          failureRate: authFailureRate,
          recentFailures: metrics.authenticationMetrics.tokenRefreshFailures
        },
        retryQueue: {
          status: metrics.healthIndicators.queueHealth,
          size: queueSize,
          maxSize: metrics.queueMetrics.maxSize
        },
        performance: {
          status: metrics.healthIndicators.performanceHealth,
          averageResponseTime: metrics.responseTimeMetrics.overall.average
        },
        retryJob: {
          status: retryJobHealth.status,
          lastRun: retryJobHealth.lastRunTime,
          isRunning: retryJobHealth.isRunning
        }
      },
      statistics: {
        activeIntegrations,
        stuckRecords,
        oldFailedRecords,
        uptime: metrics.uptime
      },
      lastUpdated: new Date()
    };
    
    // Set appropriate HTTP status
    const httpStatus = overallStatus === 'healthy' ? 200 :
                      overallStatus === 'warning' ? 200 : 503;
    
    res.status(httpStatus).json({
      success: true,
      data: healthData,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error performing Google Calendar health check', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to perform health check',
      correlationId
    });
  }
});

/**
 * Check and trigger alerts based on current metrics
 * POST /api/monitoring/google-calendar/check-alerts
 */
router.post('/google-calendar/check-alerts', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Manual alert check requested', {
      correlationId,
      requestedBy: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    const alertResults = await alertingService.checkAndTriggerAlerts(correlationId);
    
    res.json({
      success: true,
      data: alertResults,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error checking alerts', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to check alerts',
      correlationId
    });
  }
});

/**
 * Get current alert status and configuration
 * GET /api/monitoring/google-calendar/alerts/status
 */
router.get('/google-calendar/alerts/status', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Fetching alert status', {
      correlationId,
      requestedBy: req.ip
    });
    
    const alertStatus = alertingService.getAlertStatus();
    
    res.json({
      success: true,
      data: alertStatus,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching alert status', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alert status',
      correlationId
    });
  }
});

/**
 * Reset alert states (for testing or after maintenance)
 * POST /api/monitoring/google-calendar/alerts/reset
 */
router.post('/google-calendar/alerts/reset', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.warn('Alert states reset requested', {
      correlationId,
      requestedBy: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    alertingService.resetAlertStates(correlationId);
    
    res.json({
      success: true,
      message: 'Alert states reset successfully',
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error resetting alert states', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to reset alert states',
      correlationId
    });
  }
});

/**
 * Get alerting job metrics
 * GET /api/monitoring/alerting/metrics
 */
router.get('/alerting/metrics', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Fetching alerting job metrics', {
      correlationId,
      requestedBy: req.ip
    });
    
    const metrics = getAlertingJobMetrics();
    
    res.json({
      success: true,
      data: metrics,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching alerting job metrics', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alerting job metrics',
      correlationId
    });
  }
});

/**
 * Get alerting job health status
 * GET /api/monitoring/alerting/health
 */
router.get('/alerting/health', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Fetching alerting job health status', {
      correlationId,
      requestedBy: req.ip
    });
    
    const health = await getAlertingJobHealth();
    
    // Set appropriate HTTP status based on health
    const httpStatus = health.status === 'healthy' ? 200 :
                      health.status === 'warning' ? 200 :
                      health.status === 'disabled' ? 200 :
                      health.status === 'critical' ? 503 : 500;
    
    res.status(httpStatus).json({
      success: true,
      data: health,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error fetching alerting job health', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to fetch alerting job health status',
      correlationId
    });
  }
});

/**
 * Force run the alerting job (manual trigger)
 * POST /api/monitoring/alerting/force-run
 */
router.post('/alerting/force-run', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.info('Manual alerting job trigger requested', {
      correlationId,
      requestedBy: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    // Start the job asynchronously
    forceAlertingRun().catch(error => {
      structuredLogger.error('Error in manually triggered alerting job', {
        correlationId,
        error
      });
    });
    
    res.json({
      success: true,
      message: 'Alerting job triggered successfully',
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error triggering manual alerting job', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to trigger alerting job',
      correlationId
    });
  }
});

/**
 * Reset metrics collector (for testing or maintenance)
 * POST /api/monitoring/google-calendar/reset-metrics
 */
router.post('/google-calendar/reset-metrics', async (req, res) => {
  const correlationId = generateCorrelationId();
  
  try {
    structuredLogger.warn('Metrics reset requested', {
      correlationId,
      requestedBy: req.ip,
      userAgent: req.get('User-Agent')
    });
    
    // Get current metrics before reset for logging
    const currentMetrics = metricsCollector.getMetricsSummary();
    
    // Reset the metrics
    metricsCollector.resetMetrics(correlationId);
    
    res.json({
      success: true,
      message: 'Metrics collector reset successfully',
      previousMetrics: currentMetrics,
      correlationId
    });
    
  } catch (error) {
    structuredLogger.error('Error resetting metrics collector', {
      correlationId,
      error
    });
    
    res.status(500).json({
      success: false,
      error: 'Failed to reset metrics collector',
      correlationId
    });
  }
});

export default router;