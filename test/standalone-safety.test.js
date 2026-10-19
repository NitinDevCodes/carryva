const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'production';
process.env.JWT_KEY = crypto.randomBytes(48).toString('base64url');
process.env.EXPRESS_SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.MONGODB_URI = process.env.CARRYVA_STANDALONE_TEST_MONGODB_URI || 'mongodb://127.0.0.1:27017';
process.env.MONGODB_DB = `carryva_standalone_safety_${process.pid}`;

const app = require('../app');
const mongoose = require('mongoose');
const Cart = require('../models/cart-model');
const Order = require('../models/order-model');
const Product = require('../models/product-model');
const User = require('../models/user-model');
const { generateToken } = require('../utils/generateToken');
const image = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', '1bag.png'));
const server = app.listen(0);
let baseUrl;
let customer;
let owner;
let product;

before(async () => {
    await mongoose.connection.asPromise();
    await mongoose.connection.ready;
    baseUrl = `http://127.0.0.1:${server.address().port}`;
    if (mongoose.connection.supportsTransactions) return;
    await Promise.all([User.init(), Product.init(), Cart.init(), Order.init()]);
    customer = await User.create({ fullName: 'Standalone Test Customer', email: 'standalone-customer@example.com', password: 'test-hash' });
    owner = await User.create({ fullName: 'Standalone Test Owner', email: 'standalone-owner@example.com', password: 'test-hash', role: 'owner' });
    product = await Product.create({
        name: 'Standalone Safety Bag',
        description: 'A bag for transaction safety verification.',
        price: 100,
        image,
        imageContentType: 'image/png',
        category: 'Tote',
        material: 'Canvas',
        colour: 'Natural',
        stockQuantity: 2,
        availability: 'in-stock',
        bgColor: '#f4f4f4',
        panelColor: '#ffffff',
        textColor: '#111827',
    });
    await Cart.create({ userId: customer._id, items: [{ productId: product._id, quantity: 1 }] });
});

after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

test('standalone MongoDB rejects checkout and cancellation without partial writes', async (context) => {
    if (mongoose.connection.supportsTransactions) return context.skip('Configured MongoDB supports transactions; standalone safety path is not applicable.');

    const readiness = await fetch(`${baseUrl}/health/ready`);
    assert.equal(readiness.status, 503);
    assert.deepEqual(await readiness.json(), { status: 'not_ready' });

    const customerCookie = `token=${generateToken(customer)}`;
    const checkout = await fetch(`${baseUrl}/checkout/place`, {
        method: 'POST',
        headers: { cookie: customerCookie, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            idempotencyKey: crypto.randomUUID(),
            customerName: 'Test Customer',
            phone: '9876543210',
            address: '42 Garden Road',
            city: 'Mumbai',
            state: 'Maharashtra',
            postalCode: '400001',
            paymentMethod: 'cash-on-delivery',
        }),
        redirect: 'manual',
    });
    assert.equal(checkout.status, 503);
    assert.match(await checkout.text(), /does not support transactions/i);
    assert.equal(await Order.countDocuments(), 0);
    assert.equal((await Product.findById(product._id)).stockQuantity, 2);
    assert.equal((await Cart.findOne({ userId: customer._id })).items.length, 1);

    const [existingOrder] = await Order.create([{
        customerId: customer._id,
        idempotencyKey: crypto.randomUUID(),
        placementStatus: 'placed',
        items: [{
            productId: product._id,
            name: product.name,
            image,
            imageContentType: 'image/png',
            quantity: 1,
            regularUnitPrice: 100,
            unitPrice: 100,
            discount: 0,
        }],
        subtotal: 100,
        discount: 0,
        deliveryFee: 0,
        total: 100,
        deliveryAddress: {
            customerName: 'Test Customer', phone: '9876543210', address: '42 Garden Road',
            city: 'Mumbai', state: 'Maharashtra', postalCode: '400001',
        },
        paymentMethod: 'cash-on-delivery',
        paymentStatus: 'pending',
        status: 'placed',
    }]);
    const cancellation = await fetch(`${baseUrl}/owners/orders/${existingOrder._id}/status`, {
        method: 'POST',
        headers: { cookie: `token=${generateToken(owner)}`, 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ status: 'cancelled' }),
        redirect: 'manual',
    });
    assert.equal(cancellation.status, 503);
    assert.match(await cancellation.text(), /does not support transactions/i);
    assert.equal((await Order.findById(existingOrder._id)).status, 'placed');
    assert.equal((await Product.findById(product._id)).stockQuantity, 2);
    assert.equal(await Order.countDocuments(), 1);
});
