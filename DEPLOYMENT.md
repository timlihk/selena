# 🚀 Deployment Guide

Complete deployment guide for the Baby Event Tracker application on Railway.app with Cloudflare.

---

## 📋 Overview

This guide covers deploying your Baby Event Tracker to production using:
- **Railway.app** - Application hosting and database
- **Cloudflare** - DNS management and CDN
- **Custom Domain** - `selena.mangrove-hk.org`

---

## 🎯 Prerequisites

- [ ] Railway.app account
- [ ] Cloudflare account with `mangrove-hk.org` domain
- [ ] Git repository with your code
- [ ] Node.js 14+ installed locally (for CLI deployment)

---

## 1. 🚄 Railway.app Deployment

### Option A: Railway CLI (Recommended)

#### Step 1: Install Railway CLI
```bash
npm install -g @railway/cli
```

#### Step 2: Login to Railway
```bash
railway login
```

#### Step 3: Initialize Project
```bash
# Navigate to your project directory
cd selena

# Initialize Railway project
railway init
```

#### Step 4: Add PostgreSQL Database
```bash
railway add postgresql
```

#### Step 5: Deploy Application
```bash
railway up
```

Railway will automatically:
- Detect your Node.js application
- Install dependencies from `package.json`
- Set up environment variables
- Deploy your application

### Option B: GitHub Integration

#### Step 1: Push to GitHub
```bash
git add .
git commit -m "Initial deployment"
git push origin main
```

#### Step 2: Connect GitHub to Railway
1. Go to [Railway.app](https://railway.app)
2. Click "New Project"
3. Select "Deploy from GitHub repo"
4. Authorize Railway to access your repositories
5. Select your `selena` repository

#### Step 3: Add Database
1. In your Railway project, click "New"
2. Select "Database" → "PostgreSQL"
3. Railway will automatically set `DATABASE_URL`

#### Step 4: Verify Deployment
1. Check the "Deployments" tab in Railway
2. Wait for deployment to complete
3. Your app will be available at `your-app-name.up.railway.app`

---

## 2. 🌐 Cloudflare Configuration

### Step 1: Add CNAME Record

1. Log into [Cloudflare](https://cloudflare.com)
2. Select your `mangrove-hk.org` domain
3. Go to **DNS** → **Records**
4. Add a new CNAME record:

| Type | Name | Target | Proxy Status | TTL |
|------|------|--------|--------------|-----|
| CNAME | `selena` | `your-app-name.up.railway.app` | ✅ Proxied | Auto |

**Example**:
- **Name**: `selena`
- **Target**: `selena-production-a531.up.railway.app`
- **Proxy**: Enabled (orange cloud)

### Step 2: Configure SSL/TLS

1. Go to **SSL/TLS** → **Overview**
2. Set SSL/TLS encryption mode to **Full**
3. Go to **SSL/TLS** → **Edge Certificates**
4. Enable **Always Use HTTPS**
5. Enable **Automatic HTTPS Rewrites**

### Step 3: Security Settings (Optional)

1. **Security** → **Settings**:
   - Security Level: Medium
   - Bot Fight Mode: On
2. **Speed** → **Optimization**:
   - Auto Minify: Enable for JS, CSS, HTML
   - Brotli Compression: On

---

## 3. 🔗 Custom Domain Setup

### Step 1: Add Domain in Railway

1. In Railway dashboard, go to your app
2. **Settings** → **Networking** → **Custom Domains**
3. Click **"Add Domain"**
4. Enter: `selena.mangrove-hk.org`
5. Click **"Add"**

### Step 2: Add Verification Records

Railway will provide TXT records for domain verification:

1. In Cloudflare, go to **DNS** → **Records**
2. Add the TXT records provided by Railway
3. Wait for verification (5-30 minutes)

### Step 3: Verify Domain Status

1. Check Railway dashboard for domain status
2. Status should change from "Pending" to "Active"
3. Test your domain: `https://selena.mangrove-hk.org`

---

## 4. ⚙️ Environment Configuration

### Required Environment Variables

Railway automatically provides:
- `DATABASE_URL` - PostgreSQL connection string
- `PORT` - Server port (automatically set)
- `RAILWAY_STATIC_URL` - Your app's URL

### Optional Environment Variables

Add these in Railway dashboard → **Variables**:

```env
NODE_ENV=production
```

### Railway Configuration File

Your `railway.json` file:

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

---

## 5. 🔍 Verification Steps

### Step 1: Test Basic Functionality

```bash
# Test health endpoint
curl https://selena.mangrove-hk.org/health

# Test API endpoints
curl https://selena.mangrove-hk.org/api/events
curl https://selena.mangrove-hk.org/api/stats/today
```

### Step 2: Test Full Application

1. Visit `https://selena.mangrove-hk.org`
2. Add test events of each type
3. Verify statistics update correctly
4. Test on mobile devices

### Step 3: Check SSL Certificate

1. Browser should show secure lock icon
2. No mixed content warnings
3. HTTPS redirects working

---

## 6. 📊 Monitoring Setup

### Railway Monitoring

1. **Deployments**: Monitor deployment status and logs
2. **Metrics**: View CPU, memory, and network usage
3. **Logs**: Check application logs for errors

### Cloudflare Analytics

1. **Analytics** → **Traffic**: Monitor visitor statistics
2. **Security** → **Events**: View security events
3. **Speed** → **Metrics**: Performance analytics

### Health Checks

Set up external monitoring:
- **Endpoint**: `https://selena.mangrove-hk.org/health`
- **Expected**: `{"status":"OK","message":"Baby Tracker API is running"}`

---

## 7. 🛠️ Troubleshooting

### Common Issues

#### Issue: "Application Error" on Railway
**Solution**:
1. Check Railway logs for specific errors
2. Verify `DATABASE_URL` is set correctly
3. Ensure all dependencies are in `package.json`

#### Issue: DNS Not Resolving
**Solution**:
1. Verify CNAME record in Cloudflare
2. Check DNS propagation: `dig selena.mangrove-hk.org`
3. Wait 24-48 hours for full propagation

#### Issue: SSL Certificate Errors
**Solution**:
1. Check Cloudflare SSL/TLS settings
2. Ensure "Always Use HTTPS" is enabled
3. Verify domain verification in Railway

#### Issue: 404 Errors
**Solution**:
1. Check Railway custom domain configuration
2. Verify static file serving in Express
3. Check route definitions in `server.js`

### Debugging Commands

```bash
# Check DNS resolution
dig selena.mangrove-hk.org

# Test HTTPS connection
curl -I https://selena.mangrove-hk.org/

# Test API endpoints
curl https://selena.mangrove-hk.org/api/events

# Check SSL certificate
openssl s_client -connect selena.mangrove-hk.org:443
```

---

## 8. 🔄 Update Deployment

### Deploy New Changes

```bash
# Make your changes
git add .
git commit -m "Your changes"

# Deploy to Railway
railway up
# OR
git push origin main  # If using GitHub integration
```

### Rollback Deployment

1. In Railway dashboard, go to **Deployments**
2. Find the previous working deployment
3. Click "Redeploy"

---

## 9. 📈 Scaling Considerations

### Database Scaling

- Railway PostgreSQL automatically scales
- Monitor database connections in logs
- Consider connection pooling for high traffic

### Application Scaling

- Railway automatically scales based on traffic
- Monitor CPU and memory usage
- Consider adding caching for frequently accessed data

### Cost Optimization

- Monitor usage in Railway dashboard
- Consider smaller instance sizes for low traffic
- Use Cloudflare caching to reduce server load

---

## 10. 🔒 Security Checklist

- [ ] HTTPS enforced via Cloudflare
- [ ] SSL/TLS configured properly
- [ ] Environment variables secured
- [ ] Database credentials protected
- [ ] CORS configured appropriately
- [ ] Input validation implemented
- [ ] Rate limiting enabled
- [ ] Regular dependency updates

---

## 🎉 Deployment Complete!

Your Baby Event Tracker is now live at:
**https://selena.mangrove-hk.org/**

### Next Steps

1. **Monitor** your application for 24 hours
2. **Test** all functionality thoroughly
3. **Backup** your database regularly
4. **Update** dependencies periodically

### Support Resources

- [Railway Documentation](https://docs.railway.app)
- [Cloudflare Documentation](https://developers.cloudflare.com)
- [Project README](../README.md)
- [API Documentation](API.md)

---

**Need Help?** Check the troubleshooting section or create an issue in the repository.