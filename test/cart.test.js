const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, beforeEach, test } = require('node:test');

process.env.NODE_ENV = 'production';
process.env.JWT_KEY = crypto.randomBytes(48).toString('base64url');
process.env.EXPRESS_SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017';
process.env.MONGODB_DB = `carryva_cart_test_${process.pid}`;

const app = require('../app');
const bcrypt = require('bcrypt');
const { generateToken } = require('../utils/generateToken');
const mongoose = require('mongoose');
const Cart = require('../models/cart-model');
const Product = require('../models/product-model');
const User = require('../models/user-model');
const server = app.listen(0);

let baseUrl;
let customer;
let secondCustomer;
let owner;
const imageBytes = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', '1bag.png'));

async function makeUser(email, role = 'customer') {
    const password = 'cart-test-password';
    const user = await User.create({
        fullName: role === 'owner' ? 'Cart Owner' : 'Cart Customer',
        email,
        password: await bcrypt.hash(password, 10),
        role,
    });
    return { user, password, cookie: `token=${generateToken(user)}` };
}

async function makeProduct(name, overrides = {}) {
    return Product.create({
        name,
        description: 'A tested Carryva bag.',
        price: 120,
        discountedPrice: 90,
        discount: 25,
        image: imageBytes,
        imageContentType: 'image/png',
        category: 'Tote',
        material: 'Canvas',
        colour: 'Natural',
        stockQuantity: 4,
        availability: 'in-stock',
        bgColor: '#f4f4f4',
        panelColor: '#ffffff',
        textColor: '#111827',
        ...overrides,
    });
}

function post(pathname, fields, cookie) {
    return fetch(`${baseUrl}${pathname}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/x-www-form-urlencoded',
            ...(cookie ? { cookie } : {}),
        },
        body: new URLSearchParams(fields),
        redirect: 'manual',
    });
}

function get(pathname, cookie, headers = {}) {
    return fetch(`${baseUrl}${pathname}`, {
        headers: { ...(cookie ? { cookie } : {}), ...headers },
        redirect: 'manual',
    });
}

before(async () => {
    await mongoose.connection.asPromise();
    await Promise.all([User.init(), Product.init(), Cart.init()]);
    customer = await makeUser('cart-customer@example.com');
    secondCustomer = await makeUser('cart-second@example.com');
    owner = await makeUser('cart-owner@example.com', 'owner');
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(async () => {
    await Cart.deleteMany({});
});

after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

test('guest cart access and Add to Cart redirect to login with safe return paths', async () => {
    const product = await makeProduct('Guest Return Bag');
    const cartPage = await get('/cart');
    assert.equal(cartPage.status, 302);
    assert.match(cartPage.headers.get('location'), /returnTo=%2Fcart/);

    const add = await post(`/cart/items/${product._id}`, { quantity: '1' });
    assert.equal(add.status, 302);
    assert.equal(add.headers.get('location'), `/?returnTo=%2Fproducts%2F${product._id}`);
    assert.equal(await Cart.countDocuments(), 0);

    const login = await post('/users/login', {
        email: customer.user.email,
        password: customer.password,
        returnTo: 'https://attacker.example/',
    });
    assert.equal(login.status, 302);
    assert.equal(login.headers.get('location'), '/shop');

    const continuedLogin = await post('/users/login', {
        email: customer.user.email,
        password: customer.password,
        returnTo: '/cart',
    });
    assert.equal(continuedLogin.status, 302);
    assert.equal(continuedLogin.headers.get('location'), '/cart');
});

test('empty cart renders a helpful state and the authenticated navigation count is zero', async () => {
    const page = await get('/cart', customer.cookie);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Your cart is empty/);

    const count = await get('/cart/count', customer.cookie, { accept: 'application/json' });
    assert.equal(count.status, 200);
    assert.deepEqual(await count.json(), { count: 0 });

    const guestCount = await get('/cart/count', null, { accept: 'application/json' });
    assert.equal(guestCount.status, 401);

    const ownerCart = await get('/cart', owner.cookie);
    assert.equal(ownerCart.status, 403);

    const invalidProduct = await post('/cart/items/not-an-object-id', { quantity: '1' }, customer.cookie);
    assert.equal(invalidProduct.status, 404);
});

test('cart uses current database prices and discounts, persists quantities, and never accepts browser prices', async () => {
    const product = await makeProduct('Current Price Bag');
    const shopCard = await get('/shop');
    assert.match(await shopCard.text(), new RegExp(`action="/cart/items/${product._id}"`));
    const detailPage = await get(`/products/${product._id}`);
    assert.match(await detailPage.text(), new RegExp(`action="/cart/items/${product._id}"`));
    const added = await post(`/cart/items/${product._id}`, {
        quantity: '2',
        price: '0.01',
        discountedPrice: '0.01',
    }, customer.cookie);
    assert.equal(added.status, 303);

    let cart = await Cart.findOne({ userId: customer.user._id });
    assert.equal(cart.items.length, 1);
    assert.equal(cart.items[0].quantity, 2);
    assert.equal(String(cart.items[0].productId), String(product._id));

    const count = await get('/cart/count', customer.cookie, { accept: 'application/json' });
    assert.deepEqual(await count.json(), { count: 2 });
    const page = await get('/cart', customer.cookie);
    const html = await page.text();
    assert.equal(page.status, 200);
    assert.match(html, /Current Price Bag/);
    assert.match(html, /₹ 120\.00/);
    assert.match(html, /₹ 90\.00/);
    assert.match(html, /₹ 240\.00/);
    assert.match(html, /₹ 60\.00/);
    assert.match(html, /₹ 180\.00/);

    await Product.updateOne({ _id: product._id }, { $set: { price: 200, discountedPrice: 150, discount: 25 } });
    const refreshedHtml = await (await get('/cart', customer.cookie)).text();
    assert.match(refreshedHtml, /₹ 400\.00/);
    assert.match(refreshedHtml, /₹ 100\.00/);
    assert.match(refreshedHtml, /₹ 300\.00/);
});

test('quantity changes respect current availability and stock, and removal empties the cart', async () => {
    const product = await makeProduct('Limited Stock Bag', {
        price: 50,
        discountedPrice: undefined,
        discount: 0,
        stockQuantity: 2,
    });
    const addOverStock = await post(`/cart/items/${product._id}`, { quantity: '3' }, customer.cookie);
    assert.equal(addOverStock.status, 303);
    assert.equal(await Cart.countDocuments({ userId: customer.user._id }), 0);

    const added = await post(`/cart/items/${product._id}`, { quantity: '1' }, customer.cookie);
    assert.equal(added.status, 303);

    const incremented = await post(`/cart/items/${product._id}/increment`, {}, customer.cookie);
    assert.equal(incremented.status, 303);

    const tooMany = await post(`/cart/items/${product._id}/increment`, {}, customer.cookie);
    assert.equal(tooMany.status, 303);
    let cart = await Cart.findOne({ userId: customer.user._id });
    assert.equal(cart.items.find((item) => String(item.productId) === String(product._id)).quantity, 2);

    const decremented = await post(`/cart/items/${product._id}/decrement`, {}, customer.cookie);
    assert.equal(decremented.status, 303);
    cart = await Cart.findOne({ userId: customer.user._id });
    assert.equal(cart.items.find((item) => String(item.productId) === String(product._id)).quantity, 1);
    await post(`/cart/items/${product._id}/increment`, {}, customer.cookie);
    cart = await Cart.findOne({ userId: customer.user._id });
    assert.equal(cart.items.find((item) => String(item.productId) === String(product._id)).quantity, 2);

    const setTooMany = await post(`/cart/items/${product._id}/quantity`, { quantity: '3' }, customer.cookie);
    assert.equal(setTooMany.status, 303);
    cart = await Cart.findOne({ userId: customer.user._id });
    assert.equal(cart.items.find((item) => String(item.productId) === String(product._id)).quantity, 2);

    await Product.updateOne({ _id: product._id }, { $set: { stockQuantity: 1 } });
    const staleStockPage = await get('/cart', customer.cookie);
    assert.match(await staleStockPage.text(), /Only 1 are available/);
    const reconcileQuantity = await post(`/cart/items/${product._id}/quantity`, { quantity: '1' }, customer.cookie);
    assert.equal(reconcileQuantity.status, 303);
    cart = await Cart.findOne({ userId: customer.user._id });
    assert.equal(cart.items.find((item) => String(item.productId) === String(product._id)).quantity, 1);

    await Product.updateOne({ _id: product._id }, { $set: { availability: 'out-of-stock', stockQuantity: 0 } });
    const unavailableIncrement = await post(`/cart/items/${product._id}/increment`, {}, customer.cookie);
    assert.equal(unavailableIncrement.status, 303);
    assert.match(await (await get('/cart', customer.cookie)).text(), /currently unavailable/i);

    const removed = await post(`/cart/items/${product._id}/remove`, {}, customer.cookie);
    assert.equal(removed.status, 303);
    cart = await Cart.findOne({ userId: customer.user._id });
    assert.equal(cart.items.length, 0);
    assert.match(await (await get('/cart', customer.cookie)).text(), /Your cart is empty/);
});

test('customers cannot read or alter each other carts, and deleted products are safely removed', async () => {
    const product = await makeProduct('Isolated Cart Bag');
    await post(`/cart/items/${product._id}`, { quantity: '1' }, customer.cookie);

    const otherCart = await get('/cart', secondCustomer.cookie);
    assert.match(await otherCart.text(), /Your cart is empty/);
    await post(`/cart/items/${product._id}`, { quantity: '2' }, secondCustomer.cookie);
    const customerCart = await Cart.findOne({ userId: customer.user._id });
    const secondCart = await Cart.findOne({ userId: secondCustomer.user._id });
    assert.equal(customerCart.items[0].quantity, 1);
    assert.equal(secondCart.items[0].quantity, 2);

    await Product.deleteOne({ _id: product._id });
    const stalePage = await get('/cart', customer.cookie);
    assert.match(await stalePage.text(), /removed from your cart/);
    assert.equal((await Cart.findOne({ userId: customer.user._id })).items.length, 0);
    assert.equal((await Cart.findOne({ userId: secondCustomer.user._id })).items.length, 1);
});
