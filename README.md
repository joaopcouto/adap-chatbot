# CashChat
A WhatsApp chatbot designed to help you effortlessly track and manage your daily expenses. Stay on top of your finances with simple, conversational commands and real-time spending insights. Perfect for budgeting made easy! 💸🤖

## Quick Start

1. Clone the repository
2. Install dependencies: `npm install`
3. Configure environment variables (see [Configuration](#configuration))
4. Start the server: `npm start`

## Configuration

### Required Environment Variables

```bash
# Database
MONGO_URI=mongodb://localhost:27017/cashchat

# OpenAI (for AI features)
OPENAI_API_KEY=your_openai_api_key

# WhatsApp Messaging
TWILIO_PHONE_NUMBER=your_twilio_whatsapp_number

# Option 2: WhatsApp Cloud API (recommended)
WHATSAPP_CLOUD_API_ENABLED=true
WHATSAPP_ACCESS_TOKEN=your_cloud_api_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token
```

### Optional Environment Variables

```bash
# Server Configuration
NODE_ENV=development                          # development, production, test
PORT=3000                                     # Server port
LOG_LEVEL=INFO                               # DEBUG, INFO, WARN, ERROR

# Google Calendar Integration (optional)
GOOGLE_CALENDAR_INTEGRATION_ENABLED=true
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=your_oauth_redirect_uri
TOKEN_ENCRYPTION_KEY=your_32_character_encryption_key

# WhatsApp Cloud API Advanced Settings
WHATSAPP_API_VERSION=v18.0                   # API version
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_id # Optional
WHATSAPP_MAX_RETRIES=3                       # Retry attempts
WHATSAPP_REQUEST_TIMEOUT_MS=30000            # Request timeout

# Feature Flags
GOOGLE_CALENDAR_INTEGRATION_ENABLED=true
SYNC_RETRY_ENABLED=true
BACKGROUND_SYNC_ENABLED=true
ALERTING_ENABLED=true
METRICS_COLLECTION_ENABLED=true
ENHANCED_LOGGING_ENABLED=false
DEBUG_MODE_ENABLED=false
WHATSAPP_CLOUD_API_MIGRATION_MODE=false      # For gradual migration
```

## WhatsApp Cloud API Setup

For detailed WhatsApp Cloud API configuration, see [docs/CLOUD_API_SETUP.md](docs/CLOUD_API_SETUP.md).

For troubleshooting issues, see [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md).

### Quick Setup

1. Get your credentials from [Meta for Developers](https://developers.facebook.com/)
2. Set the required environment variables
3. Validate your configuration: `npm run config:cloud-api`
4. Test connectivity: `npm run config validate`

## Configuration Management

### Validation Scripts

```bash
# Validate all configuration
npm run config validate

# Check configuration status
npm run config status

# Validate Cloud API specifically
npm run config:cloud-api

# Manage feature flags
npm run config feature list
npm run config feature enable whatsappCloudApiEnabled
npm run config feature disable debugModeEnabled
```

### Configuration Health Check

```bash
# Check health of all enabled features
npm run config feature health
```

## Migration from Twilio to Cloud API

We provide comprehensive migration utilities to help you safely migrate from Twilio to WhatsApp Cloud API. For detailed instructions, see [docs/MIGRATION_GUIDE.md](docs/MIGRATION_GUIDE.md).

### Quick Migration Process

```bash
# 1. Check migration prerequisites
npm run migration:check

# 2. Generate migration configuration
npm run migration:config

# 3. Enable migration mode (gradual rollout)
npm run migration:enable

# 4. Monitor migration status
npm run migration:status

# 5. Run health checks
npm run health

# 6. If issues occur, rollback immediately
npm run rollback:emergency
```

### Migration Scripts

| Script | Description |
|--------|-------------|
| `npm run migration` | Interactive migration helper |
| `npm run migration:check` | Check migration prerequisites |
| `npm run migration:config` | Generate migration configuration |
| `npm run migration:enable` | Enable migration mode |
| `npm run migration:status` | Show current migration status |
| `npm run health` | Run comprehensive health checks |
| `npm run rollback:emergency` | Emergency rollback to Twilio |
| `npm run rollback:gradual` | Gradual rollback from full Cloud API |
| `npm run rollback:complete` | Complete rollback to Twilio-only |

### Migration States

- **Twilio Only**: Using Twilio exclusively (default)
- **Migration Mode**: Hybrid mode for testing Cloud API
- **Full Cloud API**: Using Cloud API exclusively

### Safety Features

- **Automated Prerequisites Check**: Validates configuration before migration
- **Health Monitoring**: Comprehensive service health checks
- **Rollback Procedures**: Multiple rollback options for different scenarios
- **Migration Logging**: Detailed logs of all migration activities
- **Configuration Backup**: Automatic backup before changes

## Development

### Available Scripts

```bash
# Application
npm start          # Start production server
npm run dev        # Start development server with nodemon
npm test           # Run tests
npm run test:watch # Run tests in watch mode

# Configuration management
npm run config status              # Show config status
npm run config validate           # Validate all configs
npm run config:cloud-api          # Validate Cloud API config
npm run config feature list       # List feature flags
npm run config feature health     # Check feature health

# Migration utilities
npm run migration                  # Interactive migration helper
npm run migration:check           # Check migration prerequisites
npm run migration:config          # Generate migration configuration
npm run migration:enable          # Enable migration mode
npm run migration:status          # Show migration status

# Health monitoring
npm run health                     # Run comprehensive health checks
npm run health:save               # Run health checks and save results

# Rollback procedures
npm run rollback                   # Interactive rollback helper
npm run rollback:emergency        # Emergency rollback to Twilio
npm run rollback:gradual          # Gradual rollback from Cloud API
npm run rollback:complete         # Complete rollback to Twilio
npm run rollback:validate         # Check rollback prerequisites
```

### Environment Setup

1. Copy `.env.example` to `.env` (if available)
2. Fill in your environment variables
3. Run `npm run config validate` to verify setup
4. Start development: `npm run dev`

## Features

- 💬 WhatsApp integration (Twilio or Cloud API)
- 💰 Expense tracking and categorization
- 📊 Spending insights and reports
- 📅 Google Calendar integration
- 🤖 AI-powered expense categorization
- 📈 Monthly spending summaries
- ⏰ Payment reminders
- 🔄 Automatic sync and retry mechanisms

## API Documentation

### Webhook Endpoints

- `GET /webhook` - Webhook verification
- `POST /webhook` - Receive WhatsApp messages

### Health Endpoints

- `GET /health` - Application health check
- `GET /config` - Configuration status (development only)

## Troubleshooting

### Migration Issues

1. **Migration Prerequisites Failed**
   ```bash
   npm run migration:check
   ```

2. **Migration Health Issues**
   ```bash
   npm run health
   npm run health:save  # Save detailed results
   ```

3. **Emergency Rollback**
   ```bash
   npm run rollback:emergency
   ```

### Common Issues

1. **Configuration Validation Errors**
   ```bash
   npm run config validate
   npm run config:cloud-api  # Cloud API specific
   ```

2. **Service Health Issues**
   ```bash
   npm run health --service=twilio      # Check Twilio only
   npm run health --service=cloud-api   # Check Cloud API only
   npm run health --service=database    # Check database only
   ```

3. **Database Connection Issues**
   - Check `MONGO_URI` environment variable
   - Ensure MongoDB is running
   - Run: `npm run health --service=database`

4. **Webhook Issues**
   - Verify webhook URL is accessible
   - Check webhook verification token
   - Ensure proper HTTPS setup
   - Run: `npm run config:cloud-api`

### Migration Troubleshooting

| Issue | Command | Description |
|-------|---------|-------------|
| Prerequisites failed | `npm run migration:check` | Check what's missing |
| Migration stuck | `npm run migration:status` | Check current state |
| Service unhealthy | `npm run health` | Comprehensive health check |
| Need to rollback | `npm run rollback:emergency` | Immediate rollback |
| Rollback validation | `npm run rollback:validate` | Check rollback readiness |

### Generated Files

Migration and health check utilities generate helpful files:

- `migration-config.json` - Migration configuration and plan
- `health-check-results.json` - Detailed health check results
- `migration.log` - Migration event log
- `rollback-log-*.json` - Rollback procedure logs
- `backup-*.json` - Configuration backups

### Logs

Application logs include structured information for debugging:

```bash
# Enable debug logging
DEBUG_MODE_ENABLED=true
ENHANCED_LOGGING_ENABLED=true
LOG_LEVEL=DEBUG

# Check logs for migration events
grep "migration\|rollback\|health" your-log-file.log
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `npm test`
5. Validate configuration: `npm run config validate`
6. Submit a pull request

## License

This project is licensed under the ISC License.
