const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const aiRoutes = require('./routes/ai');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security headers middleware (basic version without helmet)
app.use((req, res, next) => {
    // Basic security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
    next();
});

// Rate limiting middleware (basic version without express-rate-limit)
const rateLimitStore = new Map();
app.use((req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes
    const maxRequests = 100;

    if (!rateLimitStore.has(ip)) {
        rateLimitStore.set(ip, { count: 1, resetTime: now + windowMs });
        return next();
    }

    const userData = rateLimitStore.get(ip);

    // Reset counter if window has passed
    if (now > userData.resetTime) {
        userData.count = 1;
        userData.resetTime = now + windowMs;
        rateLimitStore.set(ip, userData);
        return next();
    }

    // Check if user has exceeded limit
    if (userData.count >= maxRequests) {
        return res.status(429).json({
            error: 'Too Many Requests',
            message: 'Please try again later.',
            retryAfter: Math.ceil((userData.resetTime - now) / 1000)
        });
    }

    // Increment counter
    userData.count++;
    rateLimitStore.set(ip, userData);
    
    // Add rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', maxRequests - userData.count);
    res.setHeader('X-RateLimit-Reset', Math.ceil(userData.resetTime / 1000));
    
    next();
});

// Clean up rate limit store periodically (every hour)
setInterval(() => {
    const now = Date.now();
    for (const [ip, data] of rateLimitStore.entries()) {
        if (now > data.resetTime) {
            rateLimitStore.delete(ip);
        }
    }
}, 60 * 60 * 1000); // Every hour

// CORS configuration
const allowedOrigins = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'http://localhost:8080',
    'https://intuiva.online',
    'https://ilkecandan.github.io',
    'https://*.github.io'
];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        // Check exact matches
        if (allowedOrigins.some(allowed => allowed === origin)) {
            return callback(null, true);
        }
        
        // Check wildcard matches
        const isAllowed = allowedOrigins.some(allowed => {
            if (allowed.includes('*')) {
                const regex = new RegExp('^' + allowed.replace('*', '.*') + '$');
                return regex.test(origin);
            }
            return false;
        });
        
        if (isAllowed) {
            callback(null, true);
        } else {
            console.log(`CORS blocked origin: ${origin}`);
            callback(new Error(`Not allowed by CORS. Origin: ${origin}`));
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200,
    maxAge: 86400,
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - IP: ${req.ip || req.connection.remoteAddress}`);
    next();
});

// Routes
app.use('/api/ai', aiRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Intuiva Backend',
        version: '1.0.0',
        uptime: process.uptime(),
        environment: process.env.NODE_ENV || 'development',
        hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
    });
});

// Test endpoint
app.get('/api/test', (req, res) => {
    res.json({
        success: true,
        message: 'Backend is working!',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        cors: {
            allowedOrigins: allowedOrigins,
            yourOrigin: req.headers.origin || 'No origin header'
        }
    });
});

// API Documentation endpoint
app.get('/api/docs', (req, res) => {
    res.json({
        api: 'Intuiva Backend API',
        version: '1.0.0',
        endpoints: [
            {
                path: '/api/ai/analyze',
                method: 'POST',
                description: 'Analyze project answers and generate tasks',
                body: {
                    answers: 'Object containing question answers',
                    projectName: 'String - Project name'
                }
            },
            {
                path: '/api/ai/test',
                method: 'GET',
                description: 'Test AI connection'
            },
            {
                path: '/health',
                method: 'GET',
                description: 'Health check endpoint'
            },
            {
                path: '/api/test',
                method: 'GET',
                description: 'Test endpoint'
            }
        ]
    });
});

// 404 handler for undefined routes
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Route not found',
        path: req.originalUrl,
        method: req.method,
        timestamp: new Date().toISOString(),
        availableEndpoints: [
            'GET /health',
            'GET /api/test',
            'GET /api/docs',
            'POST /api/ai/analyze',
            'GET /api/ai/test'
        ]
    });
});

// Global error handling middleware
app.use((err, req, res, next) => {
    console.error(`${new Date().toISOString()} - Error:`, {
        message: err.message,
        path: req.path,
        method: req.method,
        ip: req.ip || req.connection.remoteAddress
    });

    // CORS error
    if (err.message.includes('Not allowed by CORS')) {
        return res.status(403).json({
            error: 'CORS Error',
            message: 'Origin not allowed',
            yourOrigin: req.headers.origin,
            timestamp: new Date().toISOString()
        });
    }

    // Default error response
    const statusCode = err.statusCode || 500;
    const errorResponse = {
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong!',
        path: req.path,
        timestamp: new Date().toISOString()
    };

    // Add stack trace in development
    if (process.env.NODE_ENV === 'development') {
        errorResponse.stack = err.stack;
    }

    res.status(statusCode).json(errorResponse);
});

// Graceful shutdown handling
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    INTUIVA BACKEND SERVER                    ║
╠══════════════════════════════════════════════════════════════╣
║  Server running on port: ${PORT}                              ║
║  Environment: ${process.env.NODE_ENV || 'development'}        ║
║  DeepSeek API Key: ${process.env.DEEPSEEK_API_KEY ? '✅ Set' : '❌ Not set'} ║
║  Health Check: http://localhost:${PORT}/health                ║
║  API Docs: http://localhost:${PORT}/api/docs                  ║
╚══════════════════════════════════════════════════════════════╝
    `);
    
    console.log('\n📋 Available Routes:');
    console.log('─────────────────────────────────────');
    console.log('GET  /health           - Health check');
    console.log('GET  /api/test         - Test endpoint');
    console.log('GET  /api/docs         - API documentation');
    console.log('POST /api/ai/analyze   - AI task generation');
    console.log('GET  /api/ai/test      - Test AI connection');
    console.log('─────────────────────────────────────\n');
    
    console.log('🌐 CORS Allowed Origins:');
    allowedOrigins.forEach(origin => {
        console.log(`   • ${origin}`);
    });
    console.log('');
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received: shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT received: shutting down gracefully...');
    server.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

// Export for testing
module.exports = app;
