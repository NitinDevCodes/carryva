const express = require('express');
const router = express.Router();
const requireCustomer = require('../middlewares/requireCustomer');
const cart = require('../controllers/cartController');

router.get('/count', requireCustomer, cart.count);
router.get('/', requireCustomer, cart.showCart);
router.post('/items/:productId', requireCustomer, cart.addItem);
router.post('/items/:productId/increment', requireCustomer, cart.increment);
router.post('/items/:productId/decrement', requireCustomer, cart.decrement);
router.post('/items/:productId/quantity', requireCustomer, cart.setQuantity);
router.post('/items/:productId/remove', requireCustomer, cart.removeItem);

module.exports = router;
