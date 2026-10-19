const express = require('express');
const router = express.Router();
const isOwner = require('../middlewares/isOwner');
const products = require('../controllers/productsController');
const orders = require('../controllers/orderController');

router.get('/', (req, res) => res.redirect('/owners/admin'));
router.get('/login', (req, res) => res.render('owner-login'));
router.get('/admin', isOwner, products.showAdminProducts);
router.get('/createproducts', isOwner, products.showCreateForm);
router.get('/orders', isOwner, orders.ownerList);
router.get('/orders/:id', isOwner, orders.ownerDetail);
router.post('/orders/:id/status', isOwner, orders.updateStatus);

module.exports = router;
