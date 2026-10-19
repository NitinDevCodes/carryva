const express = require('express');
const router = express.Router();
const products = require('../controllers/productsController');

router.get('/', (req, res) => {
    let error = req.flash("error")
    res.render("index", {error})
});

router.get('/shop', products.listProducts);

router.get('/logout', (req, res) => res.redirect('/users/logout'));

module.exports = router;
