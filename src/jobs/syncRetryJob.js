import cron from "node-cron";
import ReminderSync from "../models/ReminderSync.js";
import syncManager from "../services/syncManager.js";
import metricsCollector from "../services/metricsCollector.js";
import { devLog } from "../helpers/logger.js";
import { structuredLogger, generateCorrelationId } from "../helpers/logger.js";
import configManager from "../config/config.js";
import featureFlagService from "../services/featureFlagService.js";

class SyncRetryJobManager {
  constructor() {
    this.isRunning = false;
    this.metrics = {
      lastRunTime: null,
      totalProcessed: 0,
      totalSucceeded: 0,
      totalFailed: 0,
      totalDelayed: 0,
      queueSize: 0,
      oldRecordsCleanedUp: 0,
      errors: []
    };
    
    // Configuration
    this.config = {
      // How often to run the retry job (every 5 minutes)
      cronSchedule: configManager.get('jobs.syncRetryCronSchedule'),
      // Maximum number of records to process per run
      batchSize: configManager.get('jobs.syncRetryBatchSize'),
      // Age threshold for cleaning up old records (30 days)
      cleanupAgeThreshold: configManager.get('jobs.syncCleanupAgeThreshold'),
      // Maximum number of old records to clean up per run
      cleanupBatchSize: configManager.get('jobs.syncCleanupBatchSize')
    };
  }

  /**
   * Start the scheduled retry job
   */
  start() {
    devLog("[SyncRetryJob] Starting sync retry job scheduler");
    
    cron.schedule(this.config.cronSchedule, async () => {
      if (this.isRunning) {
        devLog("[SyncRetryJob] Previous job still running, skipping this execution");
        return;
      }
      
      await this.processRetryQueue();
    });
    
    devLog(`[SyncRetryJob] Scheduled to run every: ${this.config.cronSchedule}`);
  }

  /**
   * Process the retry queue and perform cleanup
   */
  async processRetryQueue() {
    // Check if sync retry is enabled
    if (!featureFlagService.isEnabled('syncRetryEnabled')) {
      devLog("[SyncRetryJob] Sync retry disabled, skipping");
      return;
    }

    if (this.isRunning) {
      devLog("[SyncRetryJob] Job already running, skipping");
      return;
    }

    this.isRunning = true;
    const correlationId = generateCorrelationId();
    const startTime = Date.now();
    
    structuredLogger.info('Starting sync retry queue processing', {
      correlationId,
      batchSize: this.config.batchSize
    });

    try {
      // Reset run metrics
      const runMetrics = {
        processed: 0,
        succeeded: 0,
        failed: 0,
        delayed: 0,
        queueSizeBefore: 0,
        queueSizeAfter: 0,
        cleanedUpRecords: 0,
        errors: []
      };

      // Get queue size before processing
      runMetrics.queueSizeBefore = await this.getRetryQueueSize();
      
      // Process failed syncs
      const retryResults = await this.processFailedSyncs(correlationId, runMetrics);
      
      // Cleanup old records
      const cleanupResults = await this.cleanupOldRecords(correlationId);
      runMetrics.cleanedUpRecords = cleanupResults.deletedCount;
      
      // Get queue size after processing
      runMetrics.queueSizeAfter = await this.getRetryQueueSize();
      
      // Update overall metrics
      this.updateMetrics(runMetrics);
      
      // Update queue metrics in the metrics collector
      await metricsCollector.updateQueueMetrics(runMetrics.queueSizeAfter, correlationId);
      
      const duration = Date.now() - startTime;
      
      structuredLogger.info('Sync retry queue processing completed', {
        correlationId,
        duration,
        ...runMetrics
      });

      devLog(`[SyncRetryJob] Processing completed in ${duration}ms:`, runMetrics);

    } catch (error) {
      const duration = Date.now() - startTime;
      
      structuredLogger.error('Sync retry queue processing failed', {
        correlationId,
        duration,
        error
      });
      
      devLog("[SyncRetryJob] Error during processing:", error);
      
      // Track error in metrics
      this.metrics.errors.push({
        timestamp: new Date(),
        error: error.message,
        correlationId
      });
      
      // Keep only last 10 errors
      if (this.metrics.errors.length > 10) {
        this.metrics.errors = this.metrics.errors.slice(-10);
      }
      
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Process failed syncs that are ready for retry
   */
  async processFailedSyncs(correlationId, runMetrics) {
    try {
      // Find failed syncs ready for retry
      const failedSyncs = await ReminderSync.find({
        syncStatus: 'FAILED',
        retryCount: { $lt: 3 }, // Default max retries
        $or: [
          { lastTriedAt: null },
          { 
            lastTriedAt: { 
              $lt: new Date(Date.now() - 60000) // At least 1 minute since last try
            } 
          }
        ]
      })
      .sort({ lastTriedAt: 1 }) // Oldest first
      .limit(this.config.batchSize);

      structuredLogger.info('Found failed syncs ready for retry', {
        correlationId,
        count: failedSyncs.length,
        batchSize: this.config.batchSize
      });

      // Process each failed sync
      for (const reminderSync of failedSyncs) {
        try {
          const result = await syncManager.retryFailedSync(reminderSync);
          runMetrics.processed++;
          
          if (result.status === 'OK') {
            runMetrics.succeeded++;
            structuredLogger.debug('Retry succeeded', {
              correlationId,
              messageId: reminderSync.messageId,
              retryCount: reminderSync.retryCount + 1
            });
          } else if (result.status === 'DELAYED') {
            runMetrics.delayed++;
            structuredLogger.debug('Retry delayed', {
              correlationId,
              messageId: reminderSync.messageId,
              retryAfter: result.retryAfter
            });
          } else {
            runMetrics.failed++;
            structuredLogger.debug('Retry failed', {
              correlationId,
              messageId: reminderSync.messageId,
              reason: result.reason || result.error
            });
          }
          
        } catch (error) {
          runMetrics.processed++;
          runMetrics.failed++;
          runMetrics.errors.push({
            messageId: reminderSync.messageId,
            error: error.message
          });
          
          structuredLogger.error('Error processing individual retry', {
            correlationId,
            messageId: reminderSync.messageId,
            error
          });
        }
      }

      return runMetrics;
      
    } catch (error) {
      structuredLogger.error('Error finding failed syncs for retry', {
        correlationId,
        error
      });
      throw error;
    }
  }

  /**
   * Clean up old sync records to prevent database bloat
   */
  async cleanupOldRecords(correlationId) {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.config.cleanupAgeThreshold);
      
      // Find old successful sync records to delete (with limit)
      const recordsToDelete = await ReminderSync.find({
        syncStatus: 'OK',
        updatedAt: { $lt: cutoffDate }
      }).limit(this.config.cleanupBatchSize).select('_id');
      
      // Delete the found records
      const deleteResult = recordsToDelete.length > 0 
        ? await ReminderSync.deleteMany({
            _id: { $in: recordsToDelete.map(r => r._id) }
          })
        : { deletedCount: 0 };
      
      structuredLogger.info('Cleaned up old sync records', {
        correlationId,
        deletedCount: deleteResult.deletedCount,
        cutoffDate,
        ageThresholdDays: this.config.cleanupAgeThreshold
      });
      
      return deleteResult;
      
    } catch (error) {
      structuredLogger.error('Error cleaning up old sync records', {
        correlationId,
        error
      });
      throw error;
    }
  }

  /**
   * Get current retry queue size
   */
  async getRetryQueueSize() {
    try {
      return await ReminderSync.countDocuments({
        syncStatus: 'FAILED',
        retryCount: { $lt: 3 }
      });
    } catch (error) {
      devLog("[SyncRetryJob] Error getting queue size:", error);
      return 0;
    }
  }

  /**
   * Update overall job metrics
   */
  updateMetrics(runMetrics) {
    this.metrics.lastRunTime = new Date();
    this.metrics.totalProcessed += runMetrics.processed;
    this.metrics.totalSucceeded += runMetrics.succeeded;
    this.metrics.totalFailed += runMetrics.failed;
    this.metrics.totalDelayed += runMetrics.delayed;
    this.metrics.queueSize = runMetrics.queueSizeAfter;
    this.metrics.oldRecordsCleanedUp += runMetrics.cleanedUpRecords;
  }

  /**
   * Get current job metrics for monitoring
   */
  getMetrics() {
    return {
      ...this.metrics,
      isRunning: this.isRunning,
      config: this.config
    };
  }

  /**
   * Get health status of the retry queue
   */
  async getHealthStatus() {
    try {
      const queueSize = await this.getRetryQueueSize();
      const oldFailedCount = await ReminderSync.countDocuments({
        syncStatus: 'FAILED',
        retryCount: { $gte: 3 },
        updatedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } // Older than 24 hours
      });
      
      const totalSyncRecords = await ReminderSync.countDocuments();
      
      // Calculate health score based on various factors
      let healthScore = 100;
      
      // Penalize for large queue size
      if (queueSize > 100) healthScore -= 30;
      else if (queueSize > 50) healthScore -= 15;
      else if (queueSize > 20) healthScore -= 5;
      
      // Penalize for old failed records
      if (oldFailedCount > 50) healthScore -= 25;
      else if (oldFailedCount > 20) healthScore -= 10;
      
      // Penalize for recent errors
      const recentErrors = this.metrics.errors.filter(
        e => Date.now() - e.timestamp.getTime() < 60 * 60 * 1000 // Last hour
      );
      if (recentErrors.length > 5) healthScore -= 20;
      else if (recentErrors.length > 2) healthScore -= 10;
      
      const status = healthScore >= 80 ? 'healthy' : 
                    healthScore >= 60 ? 'warning' : 'critical';
      
      return {
        status,
        healthScore,
        queueSize,
        oldFailedCount,
        totalSyncRecords,
        recentErrorCount: recentErrors.length,
        lastRunTime: this.metrics.lastRunTime,
        isRunning: this.isRunning
      };
      
    } catch (error) {
      devLog("[SyncRetryJob] Error getting health status:", error);
      return {
        status: 'error',
        healthScore: 0,
        error: error.message
      };
    }
  }

  /**
   * Force run the retry queue processing (for manual triggers)
   */
  async forceRun() {
    devLog("[SyncRetryJob] Force running retry queue processing");
    await this.processRetryQueue();
  }
}

// Create singleton instance
const syncRetryJobManager = new SyncRetryJobManager();

/**
 * Start the sync retry job
 */
export function startSyncRetryJob() {
  devLog("[SyncRetryJob] Starting sync retry job scheduler");
  syncRetryJobManager.start();
}

/**
 * Get job metrics for monitoring
 */
export function getSyncRetryJobMetrics() {
  return syncRetryJobManager.getMetrics();
}

/**
 * Get health status for monitoring
 */
export function getSyncRetryJobHealth() {
  return syncRetryJobManager.getHealthStatus();
}

/**
 * Force run the retry queue processing
 */
export function forceSyncRetryRun() {
  return syncRetryJobManager.forceRun();
}

export default syncRetryJobManager;