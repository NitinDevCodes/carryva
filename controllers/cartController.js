const mongoose = require('mongoose');
const Cart = require('../models/cart-model');
const Product = require('../models/product-model');

const emptyTotals = { subtotal: 0, totalDiscount: 0, total: 0 };

function parseQuantity(value) {
    const raw = String(value ?? '');
    if (!/^\d+$/.test(raw)) return null;
    const quantity = Number(raw);
    return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 1000000 ? quantity : null;
}

function toCents(value) {
    return Math.round((value + Number.EPSILON) * 100);
}

function priceFor(product) {
    const regularPrice = Number.isFinite(Number(product.price)) ? Math.max(0, Number(product.price)) : 0;
    const candidate = product.discountedPrice != null
        ? Number(product.discountedPrice)
        : product.discount > 0
            ? regularPrice * (1 - product.discount / 100)
            : regularPrice;
    const roundedCandidate = Number.isFinite(candidate) ? Math.round(candidate * 100) / 100 : regularPrice;
    return { regularPrice, unitPrice: Math.max(0, Math.min(regularPrice, roundedCandidate)) };
}

function hasStock(product) {
    const stock = Number.isInteger(product.stockQuantity) ? product.stockQuantity : 1;
    return (product.availability || 'in-stock') === 'in-stock' && stock > 0;
}

function stockFor(product) {
    return Number.isInteger(product.stockQuantity) ? product.stockQuantity : 1;
}

function flashAndRedirect(req, res, key, message) {
    req.flash(key, message);
    return res.redirect(303, '/cart');
}

async function findAvailableProduct(productId) {
    if (!mongoose.isValidObjectId(productId)) return { error: 'Product not found.', status: 404 };
    const product = await Product.findById(productId).lean();
    if (!product) return { error: 'Product is no longer available.', status: 404 };
    if (!hasStock(product)) return { error: 'This product is currently unavailable.', status: 409 };
    return { product };
}

async function findOrCreateCart(userId) {
    let cart = await Cart.findOne({ userId });
    return cart || new Cart({ userId, items: [] });
}

function handleCartConflict(req, res, error) {
    if (error && (error.name === 'VersionError' || error.code === 11000)) {
        return flashAndRedirect(req, res, 'error', 'Your cart changed in another request. Please try again.');
    }
    return res.status(500).send('Unable to update your cart right now.');
}

module.exports.showCart = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user._id });
        const productsById = new Map();
        if (cart && cart.items.length) {
            const products = await Product.find({ _id: { $in: cart.items.map((item) => item.productId) } }).lean();
            for (const product of products) productsById.set(String(product._id), product);

            const availableIds = new Set(products.map((product) => String(product._id)));
            const originalLength = cart.items.length;
            cart.items = cart.items.filter((item) => availableIds.has(String(item.productId)));
            if (cart.items.length !== originalLength) {
                await cart.save();
                req.flash('error', 'A product that was removed from the shop has also been removed from your cart.');
            }
        }

        const items = (cart?.items || []).map((item) => {
            const product = productsById.get(String(item.productId));
            const { regularPrice, unitPrice } = priceFor(product);
            const stockQuantity = stockFor(product);
            const available = hasStock(product) && item.quantity <= stockQuantity;
            const lineTotal = toCents(unitPrice * item.quantity) / 100;
            return {
                product,
                productId: String(item.productId),
                quantity: item.quantity,
                regularPrice,
                unitPrice,
                lineTotal,
                lineDiscount: toCents((regularPrice - unitPrice) * item.quantity) / 100,
                stockQuantity,
                available,
                availability: product.availability || 'in-stock',
            };
        });

        const subtotalCents = items.reduce((sum, item) => sum + toCents(item.regularPrice * item.quantity), 0);
        const discountCents = items.reduce((sum, item) => sum + toCents(item.lineDiscount), 0);
        const totals = {
            subtotal: subtotalCents / 100,
            totalDiscount: discountCents / 100,
            total: (subtotalCents - discountCents) / 100,
        };
        return res.render('cart', {
            items,
            totals,
            error: req.flash('error'),
            success: req.flash('success'),
        });
    } catch (error) {
        return res.status(503).render('cart', {
            items: [],
            totals: emptyTotals,
            error: ['Your cart is temporarily unavailable. Please try again shortly.'],
            success: req.flash('success'),
        });
    }
};

module.exports.count = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user._id }).lean();
        const count = (cart?.items || []).reduce((sum, item) => sum + item.quantity, 0);
        return res.json({ count });
    } catch (error) {
        return res.status(503).json({ error: 'Cart count is unavailable.' });
    }
};

module.exports.addItem = async (req, res) => {
    const quantity = req.body.quantity === undefined ? 1 : parseQuantity(req.body.quantity);
    if (quantity === null) return flashAndRedirect(req, res, 'error', 'Choose a whole-number quantity greater than zero.');

    try {
        const result = await findAvailableProduct(req.params.productId);
        if (result.error) {
            if (result.status === 404) return res.status(404).send(result.error);
            return flashAndRedirect(req, res, 'error', result.error);
        }
        if (quantity > stockFor(result.product)) {
            return flashAndRedirect(req, res, 'error', `Only ${stockFor(result.product)} of this product are available.`);
        }

        const cart = await findOrCreateCart(req.user._id);
        const existing = cart.items.find((item) => String(item.productId) === String(result.product._id));
        const nextQuantity = (existing?.quantity || 0) + quantity;
        if (nextQuantity > stockFor(result.product)) {
            return flashAndRedirect(req, res, 'error', `Your cart cannot contain more than ${stockFor(result.product)} of this product.`);
        }
        if (existing) existing.quantity = nextQuantity;
        else cart.items.push({ productId: result.product._id, quantity });
        await cart.save();
        return flashAndRedirect(req, res, 'success', 'Added to your cart.');
    } catch (error) {
        return handleCartConflict(req, res, error);
    }
};

module.exports.increment = async (req, res) => {
    try {
        const result = await findAvailableProduct(req.params.productId);
        if (result.error) return flashAndRedirect(req, res, 'error', result.error);
        const cart = await Cart.findOne({ userId: req.user._id });
        const item = cart?.items.find((entry) => String(entry.productId) === String(result.product._id));
        if (!item) return flashAndRedirect(req, res, 'error', 'That product is not in your cart.');
        if (item.quantity >= stockFor(result.product)) {
            return flashAndRedirect(req, res, 'error', `Only ${stockFor(result.product)} of this product are available.`);
        }
        item.quantity += 1;
        await cart.save();
        return flashAndRedirect(req, res, 'success', 'Cart quantity updated.');
    } catch (error) {
        return handleCartConflict(req, res, error);
    }
};

module.exports.decrement = async (req, res) => {
    try {
        const cart = await Cart.findOne({ userId: req.user._id });
        const index = cart?.items.findIndex((entry) => String(entry.productId) === String(req.params.productId)) ?? -1;
        if (index < 0) return flashAndRedirect(req, res, 'error', 'That product is not in your cart.');
        if (cart.items[index].quantity <= 1) cart.items.splice(index, 1);
        else cart.items[index].quantity -= 1;
        await cart.save();
        return flashAndRedirect(req, res, 'success', 'Cart quantity updated.');
    } catch (error) {
        return handleCartConflict(req, res, error);
    }
};

module.exports.setQuantity = async (req, res) => {
    const quantity = parseQuantity(req.body.quantity);
    if (quantity === null) return flashAndRedirect(req, res, 'error', 'Choose a whole-number quantity greater than zero.');
    try {
        const result = await findAvailableProduct(req.params.productId);
        if (result.error) return flashAndRedirect(req, res, 'error', result.error);
        if (quantity > stockFor(result.product)) {
            return flashAndRedirect(req, res, 'error', `Only ${stockFor(result.product)} of this product are available.`);
        }
        const cart = await Cart.findOne({ userId: req.user._id });
        const item = cart?.items.find((entry) => String(entry.productId) === String(result.product._id));
        if (!item) return flashAndRedirect(req, res, 'error', 'That product is not in your cart.');
        item.quantity = quantity;
        await cart.save();
        return flashAndRedirect(req, res, 'success', 'Cart quantity updated.');
    } catch (error) {
        return handleCartConflict(req, res, error);
    }
};

module.exports.removeItem = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.productId)) return res.status(404).send('Cart item not found.');
    try {
        const cart = await Cart.findOne({ userId: req.user._id });
        if (!cart) return flashAndRedirect(req, res, 'error', 'That product is not in your cart.');
        const originalLength = cart.items.length;
        cart.items = cart.items.filter((item) => String(item.productId) !== req.params.productId);
        if (cart.items.length === originalLength) return flashAndRedirect(req, res, 'error', 'That product is not in your cart.');
        await cart.save();
        return flashAndRedirect(req, res, 'success', 'Removed from your cart.');
    } catch (error) {
        return handleCartConflict(req, res, error);
    }
};
