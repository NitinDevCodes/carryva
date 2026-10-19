if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ override: true });
}
const { validateEnvironment } = require('./config/environment');
const runtimeConfig = validateEnvironment(process.env);

const express = require('express');
const app = express();
const cookieParser = require('cookie-parser');
const path = require('path');
const indexRouter = require('./routes/index');
const ownersRouter = require('./routes/ownersRouter');
const usersRouter = require('./routes/usersRouter');
const productsRouter = require('./routes/productsRouter');
const cartRouter = require('./routes/cartRouter');
const ordersRouter = require('./routes/ordersRouter');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const flash = require('connect-flash');
const { SESSION_SECRET } = require('./config/keys');
const { setSecurityHeaders, sameOriginWrites } = require('./middlewares/security');
const { isApplicationReady } = require('./utils/readiness');

const db = require('./config/mongoose-connection');

app.disable('x-powered-by');
const proxyHops = process.env.TRUST_PROXY_HOPS;
if (proxyHops) {
    app.set('trust proxy', Number(proxyHops));
}

// Middleware
app.use(setSecurityHeaders);
app.get('/health/live', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ status: 'alive' });
});
app.get('/health/ready', (req, res) => {
    const ready = isApplicationReady(db);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
});
app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb', parameterLimit: 100 }));
app.use(cookieParser());
const sessionStore = MongoStore.create({
    clientPromise: db.asPromise().then(() => db.getClient()),
    dbName: process.env.MONGODB_DB || db.name,
    collectionName: 'sessions',
    ttl: 24 * 60 * 60,
    autoRemove: 'native',
    touchAfter: 300,
});
app.use(session({
    name: 'carryva.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
    },
}));
app.use(flash());
app.use(express.static(path.join(__dirname, 'public')));
app.use(sameOriginWrites);
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.use('/', indexRouter);
app.use('/owners', ownersRouter);
app.use('/users', usersRouter);
app.use('/cart', cartRouter);
app.use('/', ordersRouter);
app.use('/products', productsRouter);

app.use((req, res) => res.status(404).send('Page not found.'));
app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status === 413 || error.type === 'entity.too.large' ? 413
        : error.status === 400 || error.type === 'entity.parse.failed' ? 400
            : 500;
    console.error('[http] request failed', {
        name: error.name || 'Error',
        ...(Number.isInteger(error.code) ? { code: error.code } : {}),
        status,
    });
    return res.status(status).send(status === 413
        ? 'Request is too large.'
        : status === 400 ? 'Request could not be processed.' : 'The request could not be completed.');
});

const port = runtimeConfig.port;
async function start() {
    try {
        await db.ready;
        return app.listen(port, () => console.log(`Carryva listening on port ${port}`));
    } catch (error) {
        console.error('Carryva startup failed: MongoDB connection is unavailable.', {
            name: error.name || 'Error',
            ...(Number.isInteger(error.code) ? { code: error.code } : {}),
        });
        await db.close().catch(() => {});
        process.exitCode = 1;
        return null;
    }
}
if (require.main === module) {
    start();
}

app.start = start;
app.sessionStore = sessionStore;
module.exports = app;
