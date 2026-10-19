const express = require('express');
const router = express.Router();
const requireCustomer = require('../middlewares/requireCustomer');
const orders = require('../controllers/orderController');

router.get('/checkout', requireCustomer, orders.showCheckout);
router.post('/checkout/place', requireCustomer, orders.placeOrder);
router.get('/orders', requireCustomer, orders.history);
router.get('/orders/:id/confirmation', requireCustomer, orders.confirmation);
router.get('/orders/:id', requireCustomer, orders.detail);

module.exports = router;
