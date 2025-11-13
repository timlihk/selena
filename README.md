# 👶 Baby Event Tracker

A simple web application to track newborn baby events including milk feeds, diaper changes, and bath times.

## Features

- **Track Events**: Record milk feeds (with ml amount), poo-poo events, and bath times
- **Real-time Stats**: View today's summary with event counts
- **Responsive Design**: Works on desktop and mobile devices
- **Database Storage**: Events are saved in PostgreSQL database
- **Beautiful UI**: Clean, modern interface with animations

## How to Use

1. Select an event type from the dropdown (Milk, Poo-poo, or Bath)
2. For milk events, enter the amount in ml
3. Click "Add Event" to record the activity
4. View all recent events and today's statistics

## Local Development

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Set up PostgreSQL database**:
   - Install PostgreSQL locally
   - Create a database called `baby_tracker`
   - Copy `.env.example` to `.env` and update the database URL

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Open http://localhost:3000** in your browser

## Deployment to Railway.app

### Option 1: Railway CLI (Recommended)

1. **Install Railway CLI**:
   ```bash
   npm install -g @railway/cli
   ```

2. **Login to Railway**:
   ```bash
   railway login
   ```

3. **Create a PostgreSQL database**:
   ```bash
   railway add postgresql
   ```

4. **Deploy the application**:
   ```bash
   railway up
   ```

### Option 2: GitHub + Railway

1. **Push your code to GitHub**

2. **Connect GitHub to Railway.app**

3. **Create a new project in Railway** and select your repository

4. **Add PostgreSQL database**:
   - Go to your Railway project
   - Click "New" → "Database" → "PostgreSQL"
   - Railway will automatically set the `DATABASE_URL` environment variable

5. **Railway will auto-deploy** your application

## Environment Variables

- `DATABASE_URL`: PostgreSQL connection string (automatically provided by Railway)
- `NODE_ENV`: Environment (development/production)

## Technology Stack

- **Frontend**: HTML5, CSS3, Vanilla JavaScript
- **Backend**: Node.js, Express.js
- **Database**: PostgreSQL
- **Deployment**: Railway.app

## Project Structure

```
├── index.html          # Main HTML file
├── styles.css          # CSS styles
├── script.js           # Frontend JavaScript
├── server.js           # Node.js server
├── database.js         # Database configuration and models
├── package.json        # Dependencies and scripts
├── railway.json        # Railway deployment config
├── .env.example        # Environment variables template
└── README.md           # This file
```

## License

MIT License - feel free to use this for your own baby tracking needs!