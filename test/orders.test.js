const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');

process.env.NODE_ENV = 'production';
process.env.JWT_KEY = crypto.randomBytes(48).toString('base64url');
process.env.EXPRESS_SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017';
process.env.MONGODB_DB = `carryva_orders_test_${process.pid}`;

const app = require('../app');
const bcrypt = require('bcrypt');
const { generateToken } = require('../utils/generateToken');
const mongoose = require('mongoose');
const Cart = require('../models/cart-model');
const Order = require('../models/order-model');
const Product = require('../models/product-model');
const User = require('../models/user-model');
const server = app.listen(0);
let baseUrl;
let customer;
let secondCustomer;
let owner;
const imageBytes = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', '1bag.png'));

async function makeUser(email, role = 'customer') {
    const user = await User.create({
        fullName: role === 'owner' ? 'Order Owner' : 'Order Customer',
        email,
        password: await bcrypt.hash('order-test-password', 10),
        role,
    });
    return { user, cookie: `token=${generateToken(user)}` };
}

async function makeProduct(name, overrides = {}) {
    return Product.create({
        name,
        description: 'A tested Carryva bag.',
        price: 100,
        discountedPrice: 75,
        discount: 25,
        image: imageBytes,
        imageContentType: 'image/png',
        category: 'Tote',
        material: 'Canvas',
        colour: 'Natural',
        stockQuantity: 5,
        availability: 'in-stock',
        bgColor: '#f4f4f4',
        panelColor: '#ffffff',
        textColor: '#111827',
        ...overrides,
    });
}

function get(pathname, cookie, headers = {}) {
    return fetch(`${baseUrl}${pathname}`, { headers: { ...(cookie ? { cookie } : {}), ...headers }, redirect: 'manual' });
}

function post(pathname, fields, cookie) {
    return fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', ...(cookie ? { cookie } : {}) },
        body: new URLSearchParams(fields),
        redirect: 'manual',
    });
}

async function addToCart(user, product, quantity = 1) {
    await Cart.create({ userId: user.user._id, items: [{ productId: product._id, quantity }] });
}

async function checkoutContext(user = customer) {
    const response = await get('/checkout', user.cookie);
    const html = await response.text();
    const sessionCookie = response.headers.get('set-cookie')?.match(/carryva\.sid=([^;]+)/)?.[1];
    const key = html.match(/name="idempotencyKey" value="([^"]+)"/)?.[1];
    return { response, html, key, cookie: `${user.cookie}; carryva.sid=${sessionCookie}` };
}

function addressFields(context, extra = {}) {
    return {
        idempotencyKey: context.key,
        customerName: 'Avery Customer',
        phone: '+91 (98765) 43210',
        address: '42 Garden Road, Apartment 5',
        city: 'Mumbai',
        state: 'Maharashtra',
        postalCode: '400001',
        paymentMethod: 'cash-on-delivery',
        ...extra,
    };
}

before(async () => {
    await mongoose.connection.asPromise();
    await Promise.all([User.init(), Product.init(), Cart.init(), Order.init()]);
    customer = await makeUser('orders-customer@example.com');
    secondCustomer = await makeUser('orders-second@example.com');
    owner = await makeUser('orders-owner@example.com', 'owner');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
    await Promise.all([Cart.deleteMany({}), Order.deleteMany({}), Product.deleteMany({})]);
});

after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

test('checkout requires authentication, rejects empty carts and validates delivery details', async () => {
    const guest = await get('/checkout');
    assert.equal(guest.status, 302);
    assert.match(guest.headers.get('location'), /returnTo=%2Fcheckout/);

    const empty = await get('/checkout', customer.cookie);
    assert.equal(empty.status, 400);
    assert.match(await empty.text(), /Checkout is unavailable/);

    const product = await makeProduct('Address Validation Bag');
    await addToCart(customer, product);
    const context = await checkoutContext();
    const invalid = await post('/checkout/place', addressFields(context, { postalCode: 'x', paymentMethod: 'online' }), context.cookie);
    assert.equal(invalid.status, 400);
    assert.match(await invalid.text(), /valid phone number|valid postal code|cash on delivery/);
    assert.equal(await Order.countDocuments(), 0);
    assert.equal((await Cart.findOne({ userId: customer.user._id })).items.length, 1);
});

test('checkout calculates totals from current products, creates COD order, snapshots items, decrements stock and clears cart', async () => {
    const product = await makeProduct('Checkout Snapshot Bag');
    await addToCart(customer, product, 2);
    const context = await checkoutContext();
    assert.equal(context.response.status, 200);
    assert.match(context.html, /Cash on delivery/);
    for (const field of ['customerName', 'phone', 'address', 'city', 'state', 'postalCode', 'paymentMethod']) {
        assert.match(context.html, new RegExp(`name="${field}"`));
    }
    const response = await post('/checkout/place', addressFields(context, { total: '0.01', subtotal: '0.01' }), context.cookie);
    assert.equal(response.status, 303, await response.clone().text());
    assert.match(response.headers.get('location'), /^\/orders\/.+\/confirmation$/);

    const order = await Order.findOne({ customerId: customer.user._id });
    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].name, 'Checkout Snapshot Bag');
    assert.equal(order.items[0].quantity, 2);
    assert.equal(order.items[0].regularUnitPrice, 100);
    assert.equal(order.items[0].unitPrice, 75);
    assert.equal(order.items[0].imageContentType, 'image/png');
    assert.equal(order.subtotal, 200);
    assert.equal(order.discount, 50);
    assert.equal(order.deliveryFee, 0);
    assert.equal(order.total, 150);
    assert.equal(order.paymentMethod, 'cash-on-delivery');
    assert.equal(order.paymentStatus, 'pending');
    assert.equal(order.status, 'placed');
    assert.equal(order.placementStatus, 'placed');
    assert.equal((await Product.findById(product._id)).stockQuantity, 3);
    assert.equal((await Cart.findOne({ userId: customer.user._id })).items.length, 0);
    assert.match(await (await get(response.headers.get('location'), customer.cookie)).text(), /not processed an online payment/i);
});

test('duplicate form submissions return the existing order without decrementing stock twice', async () => {
    const product = await makeProduct('Idempotent Bag');
    await addToCart(customer, product, 2);
    const context = await checkoutContext();
    const fields = addressFields(context);
    const first = await post('/checkout/place', fields, context.cookie);
    const duplicate = await post('/checkout/place', fields, context.cookie);
    assert.equal(first.status, 303);
    assert.equal(duplicate.status, 303);
    assert.equal(duplicate.headers.get('location'), first.headers.get('location'));
    assert.equal(await Order.countDocuments({ customerId: customer.user._id, placementStatus: 'placed' }), 1);
    assert.equal((await Product.findById(product._id)).stockQuantity, 3);
});

test('insufficient or modified stock prevents placement and leaves cart contents intact', async () => {
    const first = await makeProduct('Available Rollback Bag', { stockQuantity: 5, price: 80, discountedPrice: undefined, discount: 0 });
    const second = await makeProduct('Low Stock Bag', { stockQuantity: 1, price: 90, discountedPrice: undefined, discount: 0 });
    await Cart.create({ userId: customer.user._id, items: [{ productId: first._id, quantity: 1 }, { productId: second._id, quantity: 2 }] });
    const context = await checkoutContext();
    assert.equal(context.response.status, 400);
    assert.match(context.html, /unavailable or has insufficient stock/i);
    assert.equal(await Order.countDocuments(), 0);
    assert.equal((await Product.findById(first._id)).stockQuantity, 5);
    assert.equal((await Cart.findOne({ userId: customer.user._id })).items.length, 2);
});

test('simultaneous checkouts cannot oversell the last unit', async () => {
    const product = await makeProduct('Last Unit Bag', { stockQuantity: 1, price: 50, discountedPrice: undefined, discount: 0 });
    await addToCart(customer, product, 1);
    await addToCart(secondCustomer, product, 1);
    const [firstContext, secondContext] = await Promise.all([checkoutContext(customer), checkoutContext(secondCustomer)]);
    const results = await Promise.all([
        post('/checkout/place', addressFields(firstContext), firstContext.cookie),
        post('/checkout/place', addressFields(secondContext), secondContext.cookie),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [303, 409]);
    assert.equal((await Product.findById(product._id)).stockQuantity, 0);
    assert.equal(await Order.countDocuments({ placementStatus: 'placed' }), 1);
    const losingUser = results[0].status === 303 ? secondCustomer : customer;
    assert.equal((await Cart.findOne({ userId: losingUser.user._id })).items.length, 1);
});

test('deleted cart products are rejected safely and cart remains available for review', async () => {
    const product = await makeProduct('Deleted Before Checkout Bag');
    await addToCart(customer, product);
    await Product.deleteOne({ _id: product._id });
    const context = await checkoutContext();
    assert.equal(context.response.status, 400);
    assert.match(context.html, /no longer available/);
    assert.equal(await Order.countDocuments(), 0);
});

test('legacy products without stock or availability fields use safe one-unit defaults', async () => {
    const legacy = await Product.collection.insertOne({
        name: 'Legacy Inventory Bag',
        description: 'Older compatible bag.',
        price: 40,
        image: imageBytes,
        imageContentType: 'image/png',
        category: 'Tote',
        material: 'Canvas',
        colour: 'Natural',
        bgColor: '#f4f4f4',
        panelColor: '#ffffff',
        textColor: '#111827',
        createdAt: new Date(),
        updatedAt: new Date(),
    });
    await addToCart(customer, { _id: legacy.insertedId }, 1);
    const context = await checkoutContext();
    assert.equal(context.response.status, 200);
    const response = await post('/checkout/place', addressFields(context), context.cookie);
    assert.equal(response.status, 303);
    const saved = await Product.collection.findOne({ _id: legacy.insertedId });
    assert.equal(saved.stockQuantity, 0);
    assert.equal((await Order.findOne({ customerId: customer.user._id })).total, 40);
});

test('customers see only their own order history and details; owner operations remain role protected', async () => {
    const product = await makeProduct('Private Order Bag');
    await addToCart(customer, product);
    const context = await checkoutContext(customer);
    const placed = await post('/checkout/place', addressFields(context), context.cookie);
    const orderId = placed.headers.get('location').split('/')[2];

    const history = await get('/orders', customer.cookie);
    assert.equal(history.status, 200);
    assert.match(await history.text(), /Private Order Bag|Your orders/);
    const otherHistory = await get('/orders', secondCustomer.cookie);
    assert.match(await otherHistory.text(), /No orders yet/);
    assert.equal((await get(`/orders/${orderId}`, secondCustomer.cookie)).status, 404);
    assert.equal((await get(`/orders/${orderId}`, customer.cookie)).status, 200);

    assert.equal((await get('/owners/orders', customer.cookie)).status, 403);
    assert.equal((await post(`/owners/orders/${orderId}/status`, { status: 'delivered' }, customer.cookie)).status, 403);
    assert.equal((await get('/owners/orders', owner.cookie)).status, 200);
    const badTransition = await post(`/owners/orders/${orderId}/status`, { status: 'delivered' }, owner.cookie);
    assert.equal(badTransition.status, 400);
    const confirmed = await post(`/owners/orders/${orderId}/status`, { status: 'confirmed' }, owner.cookie);
    assert.equal(confirmed.status, 303);
    assert.equal((await Order.findById(orderId)).status, 'confirmed');
});

test('owner cancellation restores stock and terminal orders cannot transition again', async () => {
    const product = await makeProduct('Cancel Restock Bag', { stockQuantity: 3, price: 60, discountedPrice: undefined, discount: 0 });
    await addToCart(customer, product, 2);
    const context = await checkoutContext();
    const placed = await post('/checkout/place', addressFields(context), context.cookie);
    const orderId = placed.headers.get('location').split('/')[2];
    assert.equal((await Product.findById(product._id)).stockQuantity, 1);
    const cancelled = await post(`/owners/orders/${orderId}/status`, { status: 'cancelled' }, owner.cookie);
    assert.equal(cancelled.status, 303);
    assert.equal((await Product.findById(product._id)).stockQuantity, 3);
    assert.equal((await Order.findById(orderId)).paymentStatus, 'pending');
    const invalid = await post(`/owners/orders/${orderId}/status`, { status: 'confirmed' }, owner.cookie);
    assert.equal(invalid.status, 400);
});

