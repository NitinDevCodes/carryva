const express = require('express');
const router = express.Router();
const isOwner = require('../middlewares/isOwner');
const products = require('../controllers/productsController');

router.get('/', (req, res) => res.redirect('/owners/admin'));
router.get('/login', (req, res) => res.render('owner-login'));
router.get('/admin', isOwner, products.showAdminProducts);
router.get('/createproducts', isOwner, products.showCreateForm);

module.exports = router;
