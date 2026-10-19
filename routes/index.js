const express = require('express');
const router = express.Router();
const products = require('../controllers/productsController');
const Product = require('../models/product-model');
const safeReturnPath = require('../utils/safeReturnPath');

router.get('/', async (req, res) => {
    let featuredProducts = [];
    let productError = null;
    try {
        featuredProducts = await Product.find({ isFeatured: true }).sort({ createdAt: -1, _id: -1 }).limit(4).lean();
    } catch (error) {
        productError = 'Featured products are temporarily unavailable.';
    }
    res.render('index', {
        error: req.flash('error'),
        featuredProducts,
        productError,
        returnTo: safeReturnPath(req.query.returnTo, ''),
    });
});

router.get('/shop', products.listProducts);

router.get('/logout', (req, res) => res.redirect('/users/logout'));

module.exports = router;
