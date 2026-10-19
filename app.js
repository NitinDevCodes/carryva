require('dotenv').config({ override: process.env.NODE_ENV !== 'production' });

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
const flash = require('connect-flash');
const { SESSION_SECRET } = require('./config/keys');

const db = require('./config/mongoose-connection');

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    name: 'carryva.sid',
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 24 * 60 * 60 * 1000,
    },
}));
app.use(flash());
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.use('/', indexRouter);
app.use('/owners', ownersRouter);
app.use('/users', usersRouter);
app.use('/cart', cartRouter);
app.use('/', ordersRouter);
app.use('/products', productsRouter);

const port = Number(process.env.PORT) || 3000;
if (require.main === module) {
    app.listen(port, () => console.log(`Carryva listening on http://localhost:${port}`));
}

module.exports = app;
