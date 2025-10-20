# Production Setup Guide - WhatsApp Cloud API

This guide helps you set up the application in production after the successful migration from Twilio to WhatsApp Cloud API.

## Prerequisites

1. **WhatsApp Business Account** with Cloud API access
2. **MongoDB** database
3. **OpenAI API** account
4. **Google Cloud Console** project (for calendar integration)
5. **Node.js** v18+ and npm

## Environment Configuration

### Required Environment Variables

Copy `.env.production` to `.env` and update the following required variables:

```bash
# Database
MONGO_URI=mongodb://your-mongodb-host:27017/your-database

# WhatsApp Cloud API (Required)
WHATSAPP_ACCESS_TOKEN=your_permanent_access_token
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id  
WHATSAPP_WEBHOOK_VERIFY_TOKEN=your_webhook_verify_token
WHATSAPP_BUSINESS_ACCOUNT_ID=your_business_account_id

# OpenAI (Required)
OPENAI_API_KEY=sk-your_openai_api_key

# Google OAuth (Required for calendar features)
GOOGLE_CLIENT_ID=your_google_client_id
GOOGLE_CLIENT_SECRET=your_google_client_secret
GOOGLE_REDIRECT_URI=https://yourdomain.com/auth/google/callback

# Security (Required for production)
ENCRYPTION_KEY=your_32_character_encryption_key_here_12345
```

### WhatsApp Cloud API Setup

1. **Get Access Token**:
   - Go to [Facebook Developers](https://developers.facebook.com/)
   - Create/select your app
   - Go to WhatsApp > API Setup
   - Copy the temporary access token
   - Generate a permanent access token for production

2. **Configure Webhook**:
   - Set webhook URL: `https://yourdomain.com/webhook`
   - Set verify token (same as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`)
   - Subscribe to `messages` field

3. **Phone Number**:
   - Add and verify your business phone number
   - Copy the Phone Number ID

## Installation

```bash
# Install dependencies
npm install

# Verify configuration
npm run config:validate

# Check Cloud API configuration
npm run config:cloud-api

# Run health check
npm run health
```

## Starting the Application

### Development
```bash
npm run dev
```

### Production
```bash
npm start
```

### With PM2 (Recommended for production)
```bash
# Install PM2 globally
npm install -g pm2

# Start application
pm2 start server.js --name "whatsapp-bot"

# Save PM2 configuration
pm2 save

# Setup PM2 to start on boot
pm2 startup
```

## Verification

### 1. Check Application Health
```bash
curl http://localhost:3000/health
```

### 2. Test Webhook
```bash
curl -X GET "http://localhost:3000/webhook?hub.mode=subscribe&hub.verify_token=your_verify_token&hub.challenge=test"
```

### 3. Monitor Logs
```bash
# View application logs
pm2 logs whatsapp-bot

# Or with npm
npm run dev  # Shows real-time logs
```

## Monitoring and Maintenance

### Health Checks
- **Application Health**: `GET /health`
- **Service Status**: `npm run health`
- **Configuration Status**: `npm run config:status`

### Monitoring Dashboard
Access the monitoring dashboard at: `http://localhost:3000/monitoring`

### Logs
- Application logs are structured and include correlation IDs
- Monitor error rates and response times
- Set up alerts for critical errors

## Troubleshooting

### Common Issues

1. **"No WhatsApp service provider configured"**
   - Ensure `WHATSAPP_ACCESS_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` are set
   - Verify tokens are valid and not expired

2. **Webhook verification fails**
   - Check `WHATSAPP_WEBHOOK_VERIFY_TOKEN` matches Facebook configuration
   - Ensure webhook URL is accessible from internet

3. **Database connection errors**
   - Verify `MONGO_URI` is correct
   - Check database server is running and accessible

4. **OpenAI API errors**
   - Verify `OPENAI_API_KEY` is valid
   - Check API quota and billing

### Debug Mode
Enable debug mode for detailed logging:
```bash
DEBUG_MODE_ENABLED=true npm start
```

## Security Considerations

1. **Environment Variables**: Never commit `.env` files to version control
2. **Access Tokens**: Use permanent tokens for production, rotate regularly
3. **Webhook Security**: Always verify webhook signatures
4. **Encryption**: Use strong encryption keys (32+ characters)
5. **HTTPS**: Always use HTTPS in production
6. **Rate Limiting**: Configure appropriate rate limits

## Performance Optimization

1. **Database Indexing**: Ensure proper MongoDB indexes
2. **Connection Pooling**: Configure MongoDB connection pool
3. **Caching**: Implement Redis caching if needed
4. **Load Balancing**: Use multiple instances behind load balancer
5. **Monitoring**: Set up application performance monitoring

## Backup and Recovery

1. **Database Backups**: Regular MongoDB backups
2. **Configuration Backup**: Backup environment configuration
3. **Media Files**: Backup uploaded media files
4. **Recovery Testing**: Regular recovery procedure testing

## Migration Notes

✅ **Migration Complete**: Twilio dependencies have been completely removed
✅ **Cloud API Only**: Application now exclusively uses WhatsApp Cloud API  
✅ **Backward Compatibility**: All existing functionality preserved
✅ **Enhanced Features**: Access to latest WhatsApp features

## Support

For issues or questions:
1. Check application logs for error details
2. Verify environment configuration
3. Test individual components using health checks
4. Review monitoring dashboard for system status

The application is now production-ready with WhatsApp Cloud API! 🚀