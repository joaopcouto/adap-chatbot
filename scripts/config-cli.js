#!/usr/bin/env node

/**
 * Configuration CLI Tool
 * 
 * Provides command-line interface for configuration management,
 * validation, and feature flag control.
 */

import configManager from '../src/config/config.js';
import { CloudApiConfigManager } from '../src/config/cloudApiConfig.js';
import { validateCloudApiConfig } from './validate-cloud-api-config.js';

const commands = {
  status: showConfigStatus,
  validate: validateConfiguration,
  feature: handleFeatureCommands,
  help: showHelp
};

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  const subCommand = args[1];
  const options = args.slice(2);

  try {
    if (command === 'feature') {
      await handleFeatureCommands(subCommand, options);
    } else if (commands[command]) {
      await commands[command](subCommand, options);
    } else {
      console.error(`❌ Unknown command: ${command}`);
      showHelp();
      process.exit(1);
    }
  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Show configuration status
 */
async function showConfigStatus() {
  console.log('📊 Configuration Status\n');

  try {
    const config = configManager.getAllConfig();
    
    console.log('🔧 Environment:');
    console.log(`   Node Environment: ${config.environment}`);
    console.log(`   Port: ${config.config.port}`);
    console.log(`   Log Level: ${config.config.logLevel}\n`);

    console.log('🚀 Feature Flags:');
    Object.entries(config.featureFlags).forEach(([key, value]) => {
      const status = value ? '✅' : '❌';
      console.log(`   ${key}: ${status}`);
    });

    console.log('\n📋 Service Status:');
    console.log(`   MongoDB: ${config.config.mongoUri ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Twilio: ${config.config.twilio.accountSid ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   OpenAI: ${config.config.openai.apiKey ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   Google OAuth: ${config.config.google.clientId ? '✅ Configured' : '❌ Not configured'}`);
    console.log(`   WhatsApp Cloud API: ${config.config.whatsappCloudApi.accessToken ? '✅ Configured' : '❌ Not configured'}`);

    if (config.validationErrors.length > 0) {
      console.log('\n⚠️  Validation Errors:');
      config.validationErrors.forEach(error => {
        console.log(`   • ${error}`);
      });
    } else {
      console.log('\n✅ All configurations are valid');
    }

  } catch (error) {
    console.error(`❌ Failed to get configuration status: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Validate all configurations
 */
async function validateConfiguration() {
  console.log('🔍 Configuration Validation\n');

  try {
    // Validate main configuration
    console.log('📋 Main Configuration:');
    const config = configManager.getAllConfig();
    
    if (config.validationErrors.length === 0) {
      console.log('   ✅ Main configuration is valid');
    } else {
      console.log('   ❌ Main configuration has errors:');
      config.validationErrors.forEach(error => {
        console.log(`      • ${error}`);
      });
    }

    // Validate Cloud API configuration if enabled
    const featureFlags = configManager.getFeatureFlags();
    if (featureFlags.whatsappCloudApiEnabled || featureFlags.whatsappCloudApiMigrationMode) {
      console.log('\n📱 WhatsApp Cloud API Configuration:');
      try {
        const cloudApiConfig = new CloudApiConfigManager();
        console.log('   ✅ Cloud API configuration is valid');
        
        // Test connectivity
        console.log('\n🌐 Testing Cloud API connectivity...');
        const connectivityResult = await cloudApiConfig.testConnectivity();
        if (connectivityResult.success) {
          console.log('   ✅ Cloud API connectivity test passed');
        } else {
          console.log(`   ⚠️  Cloud API connectivity test failed: ${connectivityResult.error}`);
        }
      } catch (error) {
        console.log(`   ❌ Cloud API configuration error: ${error.message}`);
      }
    }

    console.log('\n🎉 Configuration validation complete');

  } catch (error) {
    console.error(`❌ Validation failed: ${error.message}`);
    process.exit(1);
  }
}

/**
 * Handle feature flag commands
 */
async function handleFeatureCommands(subCommand, options) {
  switch (subCommand) {
    case 'list':
      await listFeatures();
      break;
    case 'enable':
      await toggleFeature(options[0], true);
      break;
    case 'disable':
      await toggleFeature(options[0], false);
      break;
    case 'health':
      await checkFeatureHealth();
      break;
    default:
      console.log('📋 Feature Commands:');
      console.log('   list     - List all feature flags');
      console.log('   enable   - Enable a feature flag');
      console.log('   disable  - Disable a feature flag');
      console.log('   health   - Check feature health status');
      console.log('\nExample: npm run config feature enable whatsappCloudApiEnabled');
  }
}

/**
 * List all feature flags
 */
async function listFeatures() {
  console.log('🚀 Feature Flags\n');

  const featureFlags = configManager.getFeatureFlags();
  const docs = configManager.getConfigurationDocs();

  Object.entries(featureFlags).forEach(([key, value]) => {
    const status = value ? '✅ Enabled' : '❌ Disabled';
    const description = docs.featureFlags[key.toUpperCase()] || 'No description available';
    
    console.log(`${key}:`);
    console.log(`   Status: ${status}`);
    console.log(`   Description: ${description}\n`);
  });
}

/**
 * Toggle feature flag
 */
async function toggleFeature(featureName, enabled) {
  if (!featureName) {
    console.error('❌ Feature name is required');
    console.log('Available features:');
    const featureFlags = configManager.getFeatureFlags();
    Object.keys(featureFlags).forEach(key => {
      console.log(`   • ${key}`);
    });
    return;
  }

  try {
    const result = configManager.updateFeatureFlag(featureName, enabled);
    const status = result ? '✅ Enabled' : '❌ Disabled';
    console.log(`🚀 Feature '${featureName}' is now ${status}`);
    
    // Show warning for critical features
    if (featureName === 'whatsappCloudApiEnabled' && enabled) {
      console.log('\n⚠️  Warning: Enabling Cloud API will affect message sending');
      console.log('   Make sure your Cloud API configuration is valid');
      console.log('   Run: npm run config:cloud-api');
    }
    
  } catch (error) {
    console.error(`❌ Failed to toggle feature: ${error.message}`);
  }
}

/**
 * Check feature health status
 */
async function checkFeatureHealth() {
  console.log('🏥 Feature Health Check\n');

  const featureFlags = configManager.getFeatureFlags();
  const config = configManager.getAllConfig();

  // Check each feature's health
  for (const [feature, enabled] of Object.entries(featureFlags)) {
    console.log(`${feature}:`);
    console.log(`   Status: ${enabled ? '✅ Enabled' : '❌ Disabled'}`);
    
    if (enabled) {
      // Check feature-specific health
      switch (feature) {
        case 'googleCalendarIntegrationEnabled':
          checkGoogleCalendarHealth(config.config);
          break;
        case 'whatsappCloudApiEnabled':
          await checkCloudApiHealth();
          break;
        case 'metricsCollectionEnabled':
          console.log('   Health: ✅ Metrics collection is active');
          break;
        default:
          console.log('   Health: ✅ Feature is enabled');
      }
    }
    console.log('');
  }
}

/**
 * Check Google Calendar integration health
 */
function checkGoogleCalendarHealth(config) {
  const hasCredentials = config.google.clientId && config.google.clientSecret;
  const hasEncryption = config.encryption.key && config.encryption.key !== 'default-key-for-development-only';
  
  if (hasCredentials && hasEncryption) {
    console.log('   Health: ✅ Google Calendar integration is properly configured');
  } else {
    console.log('   Health: ⚠️  Missing configuration:');
    if (!hasCredentials) console.log('      • Google OAuth credentials missing');
    if (!hasEncryption) console.log('      • Secure encryption key missing');
  }
}

/**
 * Check Cloud API health
 */
async function checkCloudApiHealth() {
  try {
    const cloudApiConfig = new CloudApiConfigManager();
    const summary = cloudApiConfig.getConfigSummary();
    
    if (summary.hasAccessToken && summary.hasWebhookToken) {
      console.log('   Health: ✅ Cloud API is properly configured');
      
      // Test connectivity
      const connectivityResult = await cloudApiConfig.testConnectivity();
      if (connectivityResult.success) {
        console.log('   Connectivity: ✅ API is reachable');
      } else {
        console.log('   Connectivity: ⚠️  API connectivity issues');
      }
    } else {
      console.log('   Health: ❌ Missing required Cloud API configuration');
    }
  } catch (error) {
    console.log(`   Health: ❌ Configuration error: ${error.message}`);
  }
}

/**
 * Show help information
 */
function showHelp() {
  console.log('🔧 Configuration CLI Tool\n');
  
  console.log('Usage: npm run config <command> [options]\n');
  
  console.log('Commands:');
  console.log('   status              Show configuration status');
  console.log('   validate            Validate all configurations');
  console.log('   feature <command>   Manage feature flags');
  console.log('   help                Show this help message\n');
  
  console.log('Feature Commands:');
  console.log('   feature list        List all feature flags');
  console.log('   feature enable <name>   Enable a feature flag');
  console.log('   feature disable <name>  Disable a feature flag');
  console.log('   feature health      Check feature health status\n');
  
  console.log('Examples:');
  console.log('   npm run config status');
  console.log('   npm run config validate');
  console.log('   npm run config feature list');
  console.log('   npm run config feature enable whatsappCloudApiEnabled');
  console.log('   npm run config:cloud-api  # Validate Cloud API specifically\n');
  
  console.log('Environment Variables:');
  console.log('   Use .env file or set environment variables directly');
  console.log('   Run "npm run config validate" for detailed requirements');
}

// Run CLI if script is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { main as configCli };