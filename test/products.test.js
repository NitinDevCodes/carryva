const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { after, before, test } = require('node:test');

process.env.NODE_ENV = 'production';
process.env.JWT_KEY = crypto.randomBytes(48).toString('base64url');
process.env.EXPRESS_SESSION_SECRET = crypto.randomBytes(48).toString('base64url');
process.env.MONGODB_URI = 'mongodb://127.0.0.1:27017';
process.env.MONGODB_DB = `carryva_product_test_${process.pid}`;

const app = require('../app');
const bcrypt = require('bcrypt');
const { generateToken } = require('../utils/generateToken');
const mongoose = require('mongoose');
const Product = require('../models/product-model');
const User = require('../models/user-model');
const { promoteOwner } = require('../scripts/promote-owner');
const server = app.listen(0);

let baseUrl;
let customerCookie;
let ownerCookie;
let createdProduct;
let secondProduct;

const pngBytes = fs.readFileSync(path.join(__dirname, '..', 'public', 'images', '1bag.png'));

async function createUser(email, role) {
    const password = await bcrypt.hash('test-password-strong', 10);
    const user = await User.create({ fullName: role === 'owner' ? 'Catalog Owner' : 'Catalog Customer', email, password, role });
    return { user, cookie: `token=${generateToken(user)}` };
}

async function sendProduct(path, fields, cookie, files) {
    const form = new FormData();
    for (const [name, value] of Object.entries(fields)) form.append(name, String(value));
    const uploads = files ? (Array.isArray(files) ? files : [files]) : [];
    for (const file of uploads) {
        form.append(file.field || 'images', new Blob([file.bytes], { type: file.type }), file.name || 'product.png');
    }
    return fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: cookie ? { cookie } : {},
        body: form,
        redirect: 'manual',
    });
}

async function login(email, password) {
    return fetch(`${baseUrl}/users/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ email, password }),
        redirect: 'manual',
    });
}

function validFields(overrides = {}) {
    return {
        name: 'Carryva Tote',
        description: 'A structured everyday tote with considered storage.',
        price: '100',
        discountedPrice: '90',
        category: 'Tote',
        material: 'Organic cotton canvas',
        colour: 'Natural',
        dimensions: '38 × 30 × 14 cm',
        capacity: '16 L',
        weight: '620',
        features: 'Interior zip pocket\nMagnetic closure\nTwo compartments',
        careInstructions: 'Spot clean with a damp cloth.',
        warranty: 'One year limited warranty.',
        stockQuantity: '12',
        availability: 'in-stock',
        bgColor: '#f4f4f4',
        panelColor: '#ffffff',
        textColor: '#111827',
        isNewCollection: 'on',
        isFeatured: 'on',
        ...overrides,
    };
}

before(async () => {
    await mongoose.connection.asPromise();
    await Promise.all([User.init(), Product.init()]);
    const customer = await createUser('catalog-customer@example.com', 'customer');
    const owner = await createUser('catalog-owner@example.com', 'owner');
    customerCookie = customer.cookie;
    ownerCookie = owner.cookie;
    baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
});

test('shop and product details are public and empty or missing states render correctly', async () => {
    const shop = await fetch(`${baseUrl}/shop`);
    assert.equal(shop.status, 200);
    assert.match(await shop.text(), /No products match this view yet/);

    const listing = await fetch(`${baseUrl}/products`);
    assert.equal(listing.status, 200);

    const missing = await fetch(`${baseUrl}/products/not-an-object-id`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Product not found/);
});

test('customers and anonymous visitors cannot access owner operations', async () => {
    const anonymous = await fetch(`${baseUrl}/owners/admin`, { redirect: 'manual' });
    assert.equal(anonymous.status, 302);

    const customerAdmin = await fetch(`${baseUrl}/owners/admin`, {
        headers: { cookie: customerCookie },
        redirect: 'manual',
    });
    assert.equal(customerAdmin.status, 403);

    const customerCreate = await sendProduct('/products/create', validFields(), customerCookie, {
        bytes: pngBytes,
        type: 'image/png',
    });
    assert.equal(customerCreate.status, 403);
    assert.equal(await Product.countDocuments(), 0);
});

test('configured owner accounts use the existing login flow and land in administration', async () => {
    const loginPage = await fetch(`${baseUrl}/owners/login`);
    assert.equal(loginPage.status, 200);
    const response = await login('catalog-owner@example.com', 'test-password-strong');
    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/owners/admin');
    assert.ok(response.headers.getSetCookie().some((cookie) => cookie.startsWith('token=')));
});

test('owners can open product administration and invalid product data or image files are rejected', async () => {
    const admin = await fetch(`${baseUrl}/owners/admin`, { headers: { cookie: ownerCookie } });
    assert.equal(admin.status, 200);
    assert.match(await admin.text(), /No products have been added yet/);

    const form = await fetch(`${baseUrl}/owners/createproducts`, { headers: { cookie: ownerCookie } });
    assert.equal(form.status, 200);
    const formHtml = await form.text();
    for (const name of [
        'images', 'name', 'description', 'price', 'discountedPrice', 'category', 'material', 'colour',
        'dimensions', 'capacity', 'weight', 'features', 'careInstructions', 'warranty', 'stockQuantity',
        'availability', 'isNewCollection', 'isFeatured', 'bgColor', 'panelColor', 'textColor',
    ]) {
        assert.match(formHtml, new RegExp(`name="${name}"`), `owner form should edit ${name}`);
    }
    assert.match(formHtml, /multiple/);

    const invalidPrice = await sendProduct('/products/create', validFields({ price: '-5' }), ownerCookie, {
        bytes: pngBytes,
        type: 'image/png',
    });
    assert.equal(invalidPrice.status, 400);

    const invalidDiscount = await sendProduct('/products/create', validFields({ discountedPrice: '100' }), ownerCookie, {
        bytes: pngBytes,
        type: 'image/png',
    });
    assert.equal(invalidDiscount.status, 400);

    const invalidStock = await sendProduct('/products/create', validFields({ stockQuantity: '1.5' }), ownerCookie, {
        bytes: pngBytes,
        type: 'image/png',
    });
    assert.equal(invalidStock.status, 400);

    const missingMaterial = await sendProduct('/products/create', validFields({ material: '' }), ownerCookie, {
        bytes: pngBytes,
        type: 'image/png',
    });
    assert.equal(missingMaterial.status, 400);

    const invalidColor = await sendProduct('/products/create', validFields({ bgColor: 'red;display:none' }), ownerCookie, {
        bytes: pngBytes,
        type: 'image/png',
    });
    assert.equal(invalidColor.status, 400);

    const wrongMime = await sendProduct('/products/create', validFields(), ownerCookie, {
        bytes: pngBytes,
        type: 'image/svg+xml',
        name: 'unsafe.svg',
    });
    assert.equal(wrongMime.status, 400);

    const wrongSignature = await sendProduct('/products/create', validFields(), ownerCookie, {
        bytes: pngBytes.subarray(0, 8),
        type: 'image/png',
    });
    assert.equal(wrongSignature.status, 400);

    const oversized = await sendProduct('/products/create', validFields(), ownerCookie, {
        bytes: Buffer.alloc(5 * 1024 * 1024 + 1),
        type: 'image/png',
    });
    assert.equal(oversized.status, 413);

    const tooManyImages = await sendProduct('/products/create', validFields(), ownerCookie,
        Array.from({ length: 7 }, () => ({ bytes: pngBytes, type: 'image/png' })));
    assert.equal(tooManyImages.status, 400);
    assert.equal(await Product.countDocuments(), 0);
});

test('owner product CRUD persists validated products and serves filtered, sorted public views', async () => {
    const created = await sendProduct('/products/create', validFields(), ownerCookie, [
        { bytes: pngBytes, type: 'image/png' },
        { bytes: pngBytes, type: 'image/png' },
    ]);
    assert.equal(created.status, 302);
    assert.equal(created.headers.get('location'), '/owners/admin');
    createdProduct = await Product.findOne({ name: 'Carryva Tote' });
    assert.ok(createdProduct);
    assert.equal(createdProduct.imageContentType, 'image/png');
    assert.equal(createdProduct.images.length, 1);
    assert.equal(createdProduct.description, validFields().description);
    assert.equal(createdProduct.discountedPrice, 90);
    assert.equal(createdProduct.discount, 10);
    assert.equal(createdProduct.category, 'Tote');
    assert.equal(createdProduct.material, 'Organic cotton canvas');
    assert.equal(createdProduct.colour, 'Natural');
    assert.equal(createdProduct.dimensions, '38 × 30 × 14 cm');
    assert.equal(createdProduct.capacity, '16 L');
    assert.equal(createdProduct.weight, 620);
    assert.deepEqual(createdProduct.features, ['Interior zip pocket', 'Magnetic closure', 'Two compartments']);
    assert.equal(createdProduct.stockQuantity, 12);
    assert.equal(createdProduct.availability, 'in-stock');
    assert.equal(createdProduct.isFeatured, true);
    assert.equal(createdProduct.isNewCollection, true);

    const home = await fetch(`${baseUrl}/`);
    assert.match(await home.text(), /Carryva Tote/);

    const second = await sendProduct('/products/create', validFields({
        name: 'Everyday Pouch', price: '50', discountedPrice: '', discount: '0', isNewCollection: '', isFeatured: '',
    }), ownerCookie, { bytes: pngBytes, type: 'image/png', field: 'image' });
    assert.equal(second.status, 302);
    secondProduct = await Product.findOne({ name: 'Everyday Pouch' });
    assert.ok(secondProduct);

    const customerEditForm = await fetch(`${baseUrl}/products/${createdProduct._id}/edit`, {
        headers: { cookie: customerCookie },
        redirect: 'manual',
    });
    assert.equal(customerEditForm.status, 403);

    const customerUpdate = await sendProduct(`/products/${createdProduct._id}/update`, validFields({ price: '1' }), customerCookie);
    assert.equal(customerUpdate.status, 403);

    const ownerEditForm = await fetch(`${baseUrl}/products/${createdProduct._id}/edit`, {
        headers: { cookie: ownerCookie },
    });
    assert.equal(ownerEditForm.status, 200);
    const editFormHtml = await ownerEditForm.text();
    assert.match(editFormHtml, /A structured everyday tote/);
    assert.match(editFormHtml, /Organic cotton canvas/);
    assert.match(editFormHtml, /Interior zip pocket/);

    const detail = await fetch(`${baseUrl}/products/${createdProduct._id}`);
    assert.equal(detail.status, 200);
    const detailBody = await detail.text();
    assert.match(detailBody, /Carryva Tote/);
    assert.match(detailBody, /Organic cotton canvas/);
    assert.match(detailBody, /16 L/);
    assert.match(detailBody, /Interior zip pocket/);
    assert.equal((detailBody.match(/data:image\/png;base64,/g) || []).length, 2);

    const sorted = await fetch(`${baseUrl}/shop?sortby=price-high`);
    assert.equal(sorted.status, 200);
    const sortedBody = await sorted.text();
    assert.ok(sortedBody.indexOf('Carryva Tote') < sortedBody.indexOf('Everyday Pouch'));

    const newCollection = await fetch(`${baseUrl}/shop?filter=new`);
    const newBody = await newCollection.text();
    assert.match(newBody, /Carryva Tote/);
    assert.doesNotMatch(newBody, /Everyday Pouch/);

    const discounted = await fetch(`${baseUrl}/shop?filter=discounted`);
    const discountedBody = await discounted.text();
    assert.match(discountedBody, /Carryva Tote/);
    assert.doesNotMatch(discountedBody, /Everyday Pouch/);

    const update = await sendProduct(`/products/${createdProduct._id}/update`, validFields({
        price: '80', discountedPrice: '60', isNewCollection: '', isFeatured: '',
        description: 'Updated product description.',
        category: 'Shoulder bag', material: 'Recycled leather', colour: 'Black',
        dimensions: '32 × 22 × 10 cm', capacity: '10 L', weight: '540',
        features: 'Adjustable strap\nInterior pocket', careInstructions: 'Wipe clean.',
        warranty: 'Two year warranty.', stockQuantity: '4', availability: 'preorder',
    }), ownerCookie, { bytes: pngBytes, type: 'image/png' });
    assert.equal(update.status, 302);
    const updated = await Product.findById(createdProduct._id);
    assert.equal(updated.price, 80);
    assert.equal(updated.discount, 25);
    assert.equal(updated.discountedPrice, 60);
    assert.equal(updated.isNewCollection, false);
    assert.equal(updated.isFeatured, false);
    assert.equal(updated.description, 'Updated product description.');
    assert.equal(updated.material, 'Recycled leather');
    assert.equal(updated.stockQuantity, 4);
    assert.equal(updated.availability, 'preorder');
    assert.equal(updated.imageContentType, 'image/png');
    assert.equal(updated.image.equals(pngBytes), true);
    assert.equal(updated.images.length, 0);

    const customerDelete = await fetch(`${baseUrl}/products/${createdProduct._id}/delete`, {
        method: 'POST', headers: { cookie: customerCookie }, redirect: 'manual',
    });
    assert.equal(customerDelete.status, 403);

    const deleted = await fetch(`${baseUrl}/products/${secondProduct._id}/delete`, {
        method: 'POST', headers: { cookie: ownerCookie }, redirect: 'manual',
    });
    assert.equal(deleted.status, 302);
    assert.equal(await Product.findById(secondProduct._id), null);

    const ownerPage = await fetch(`${baseUrl}/owners/admin`, { headers: { cookie: ownerCookie } });
    assert.equal(ownerPage.status, 200);
    assert.match(await ownerPage.text(), /Carryva Tote/);
});

test('legacy products without the expanded catalog fields still render on the shop and detail page', async () => {
    const legacyId = new mongoose.Types.ObjectId();
    await Product.collection.insertOne({
        _id: legacyId,
        name: 'Legacy Carryall',
        price: 75,
        discount: 20,
        image: pngBytes,
        imageContentType: 'image/png',
        bgColor: '#f4f4f4',
        panelColor: '#ffffff',
        textColor: '#111827',
        isNewCollection: false,
        createdAt: new Date(),
        updatedAt: new Date(),
    });

    const shop = await fetch(`${baseUrl}/shop`);
    assert.equal(shop.status, 200);
    assert.match(await shop.text(), /Legacy Carryall/);
    const detail = await fetch(`${baseUrl}/products/${legacyId}`);
    assert.equal(detail.status, 200);
    const body = await detail.text();
    assert.match(body, /Legacy Carryall/);
    assert.match(body, /Other/);
    assert.match(body, /₹ 60\.00/);
    assert.equal((body.match(/data:image\/png;base64,/g) || []).length, 1);
    await Product.collection.deleteOne({ _id: legacyId });
});

test('owner promotion updates an existing account through the database-only setup helper', async () => {
    await promoteOwner(' CATALOG-CUSTOMER@EXAMPLE.COM ');
    const promoted = await User.findOne({ email: 'catalog-customer@example.com' });
    assert.equal(promoted.role, 'owner');

    const ownerPage = await fetch(`${baseUrl}/owners/admin`, {
        headers: { cookie: customerCookie },
    });
    assert.equal(ownerPage.status, 200);
});
