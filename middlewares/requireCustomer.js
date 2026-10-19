const isLoggedIn = require('./isLoggedIn');
const mongoose = require('mongoose');

module.exports = function requireCustomer(req, res, next) {
    if (!req.cookies?.token && req.path === '/count') {
        return res.status(401).json({ error: 'Log in to view your cart.' });
    }
    const productId = req.params.productId;
    req.loginReturnTo = req.method === 'POST' && productId && mongoose.isValidObjectId(productId)
        ? `/products/${productId}`
        : req.path === '/checkout' || req.path === '/checkout/place'
            ? '/checkout'
            : req.path.startsWith('/orders')
                ? '/orders'
                : '/cart';

    return isLoggedIn(req, res, () => {
        if (req.user.role !== 'customer') return res.status(403).send('Customer cart access is required.');
        return next();
    });
};
