const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const aiRoutes = require('./routes/ai');

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://cdnjs.cloudflare.com"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
        },
    },
    crossOriginEmbedderPolicy: false,
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: 'Too many requests from this IP, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

app.use(limiter);

// CORS configuration
const allowedOrigins = [
    'http://localhost:5500',
    'http://127.0.0.1:5500',
    'http://localhost:3000',
    'http://localhost:8080',
    'https://intuiva.online',
    'https://ilkecandan.github.io',
    'https://*.github.io' // Allow all GitHub Pages subdomains
];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            // Check if origin is a subdomain of allowed domains
            const isAllowedSubdomain = allowedOrigins.some(allowedOrigin => {
                if (allowedOrigin.includes('*')) {
                    const regexPattern = allowedOrigin.replace('*', '.*');
                    return new RegExp(regexPattern).test(origin);
                }
                return false;
            });
            
            if (isAllowedSubdomain) {
                callback(null, true);
            } else {
                console.log(`Blocked by CORS: ${origin}`);
                callback(new Error('Not allowed by CORS'));
            }
        }
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Accept', 'X-Requested-With'],
    credentials: true,
    optionsSuccessStatus: 200,
    maxAge: 86400, // 24 hours
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.path} - ${req.ip}`);
    next();
});

// Routes
app.use('/api/ai', aiRoutes);

// Health check endpoint with detailed info
app.get('/health', (req, res) => {
    const healthcheck = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Intuiva Backend',
        version: '1.0.0',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        environment: process.env.NODE_ENV || 'development',
        nodeVersion: process.version,
        platform: process.platform,
        hasDeepSeekKey: !!process.env.DEEPSEEK_API_KEY,
    };
    
    res.setHeader('Content-Type', 'application/json');
    res.status(200).json(healthcheck);
});

// Test endpoint with more details
app.get('/api/test', (req, res) => {
    res.json({
        message: 'Backend is working!',
        environment: process.env.NODE_ENV || 'development',
        timestamp: new Date().toISOString(),
        endpoints: {
            ai: '/api/ai/analyze',
            health: '/health',
            test: '/api/test'
        },
        cors: {
            allowedOrigins: allowedOrigins,
            enabled: true
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
        stack: err.stack,
        path: req.path,
        method: req.method,
        ip: req.ip
    });

    // CORS error
    if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({
            error: 'CORS Error',
            message: 'Origin not allowed',
            allowedOrigins: allowedOrigins,
            yourOrigin: req.headers.origin
        });
    }

    // Rate limit error
    if (err.name === 'RateLimitError') {
        return res.status(429).json({
            error: 'Rate Limit Exceeded',
            message: err.message
        });
    }

    // Default error response
    const statusCode = err.statusCode || 500;
    const errorResponse = {
        error: err.name || 'Internal Server Error',
        message: err.message || 'Something went wrong!',
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
process.on('SIGTERM', () => {
    console.log('SIGTERM signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

process.on('SIGINT', () => {
    console.log('SIGINT signal received: closing HTTP server');
    server.close(() => {
        console.log('HTTP server closed');
        process.exit(0);
    });
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Start server
const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    INTUIVA BACKEND SERVER                    ║
╠══════════════════════════════════════════════════════════════╣
║  Server running on port: ${PORT}                              ║
║  Environment: ${process.env.NODE_ENV || 'development'}        ║
║  DeepSeek API Key: ${process.env.DEEPSEEK_API_KEY ? '✅ Set' : '❌ Not set'} ║
║  CORS Allowed Origins: ${allowedOrigins.length}               ║
║  Health Check: http://localhost:${PORT}/health                ║
║  API Docs: http://localhost:${PORT}/api/docs                  ║
╚══════════════════════════════════════════════════════════════╝
    `);
    
    // Log all available routes
    console.log('\n📋 Available Routes:');
    console.log('─────────────────────────────────────');
    console.log('GET  /health           - Health check');
    console.log('GET  /api/test         - Test endpoint');
    console.log('GET  /api/docs         - API documentation');
    console.log('POST /api/ai/analyze   - AI task generation');
    console.log('GET  /api/ai/test      - Test AI connection');
    console.log('─────────────────────────────────────\n');
});

// Export for testing
module.exports = app;
