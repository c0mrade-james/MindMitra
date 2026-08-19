const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const morgan = require('morgan');
const compression = require('compression');
const mongoSanitize = require('express-mongo-sanitize');
const xssClean = require('xss-clean');

const corsOptions = require('./config/corsOptions');
const { generalLimiter } = require('./middlewares/rateLimiter.middleware');
const errorMiddleware = require('./middlewares/error.middleware');
const ApiError = require('./utils/ApiError');
const { StatusCodes } = require('http-status-codes');
const env = require('./config/env');

const app = express();

app.set('trust proxy', 1); // needed on Render for secure cookies / rate-limit IP detection

app.use(helmet());
app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(cookieParser());
app.use(compression({
  filter: (req, res) => {
    // Don't compress SSE streams — they must be sent immediately
    if (req.path.includes('/chat/stream')) return false;
    return compression.filter(req, res);
  },
}));
app.use(mongoSanitize());
app.use(xssClean());
app.use(morgan(env.nodeEnv === 'development' ? 'dev' : 'combined'));
app.use(generalLimiter);

app.get('/', (_req, res) => {
  res.json({ success: true, message: 'MindMitra API is running', version: 'v1' });
});
app.get('/health', (_req, res) => res.json({ success: true, status: 'ok', uptime: process.uptime() }));

app.use('/api/v1', require('./routes'));

app.use((req, _res, next) => {
  next(new ApiError(StatusCodes.NOT_FOUND, `Route not found: ${req.originalUrl}`));
});

app.use(errorMiddleware);

module.exports = app;
