// server/index.js — ProjectHimaloy API entry point
const express = require('express');
const cors = require('cors');
require('dotenv').config();
require('./utils/cronJobs');

const { connectDB } = require('./config/db');

const app = express();

// ============================================================
// ==================== CORS MIDDLEWARE ========================
// ============================================================

app.use((req, res, next) => {
    const allowedOrigins = [
        'https://project-himaloy-client.vercel.app',
        'https://project-himaloy-server.vercel.app',
        'http://localhost:3000',
        'http://localhost:5000',
    ];

    const origin = req.headers.origin;
    if (allowedOrigins.includes(origin)) {
        res.header('Access-Control-Allow-Origin', origin);
    }

    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    next();
});

app.use(cors({
    origin: [
        'http://localhost:3000',
        'http://localhost:5000',
        'https://project-himaloy-client.vercel.app',
        'https://project-himaloy-server.vercel.app',
        process.env.FRONTEND_URL,
        process.env.BETTER_AUTH_URL
    ].filter(Boolean),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// ============================================================
// ==================== HEALTH CHECK ==========================
// ============================================================

app.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'ProjectHimaloy API is running!',
        timestamp: new Date().toISOString()
    });
});

app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        status: 'healthy',
        timestamp: new Date().toISOString()
    });
});

// ============================================================
// ==================== ROUTE MODULES ==========================
// ============================================================

app.use(require('./routes/managerPin'));
app.use(require('./routes/users'));
app.use(require('./routes/adminManager'));
app.use(require('./routes/deposits'));
app.use(require('./routes/loans'));
app.use(require('./routes/voting'));
app.use(require('./routes/installments'));
app.use(require('./routes/meetings'));
app.use(require('./routes/transactions'));
app.use(require('./routes/notifications'));
app.use(require('./routes/managerCycles'));
app.use(require('./routes/dashboard'));
app.use(require('./routes/fund'));
app.use(require('./routes/settings'));
app.use(require('./routes/savings'));
app.use(require('./routes/members'));
app.use(require('./routes/community'));
app.use(require('./routes/messages'));

// ============================================================
// ==================== EXPORT & START ========================
// ============================================================

// Global error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ success: false, message: err.message || 'Internal server error' });
});

module.exports = app;

if (require.main === module) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, async () => {
        console.log(`🚀 ProjectHimaloy server running on port ${PORT}`);
        try {
            await connectDB();
        } catch (error) {
            console.error('Failed to connect to MongoDB:', error);
        }
    });
}
