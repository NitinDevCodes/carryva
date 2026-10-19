const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Cart = require('../models/cart-model');
const Product = require('../models/product-model');
const Order = require('../models/order-model');

const DELIVERY_FEE = 0;
const transitions = {
    placed: ['confirmed', 'cancelled'],
    confirmed: ['processing', 'cancelled'],
    processing: ['shipped', 'cancelled'],
    shipped: ['delivered'],
    delivered: [],
    cancelled: [],
};

function cents(value) { return Math.round((Number(value) + Number.EPSILON) * 100); }
function dollars(value) { return value / 100; }
function priceFor(product) {
    const regular = Number(product.price);
    const candidate = product.discountedPrice != null
        ? Number(product.discountedPrice)
        : Number(product.discount) > 0 ? regular * (1 - Number(product.discount) / 100) : regular;
    const unit = Math.max(0, Math.min(cents(regular), cents(candidate)));
    return { regularCents: cents(regular), unitCents: unit };
}
function renderCheckout(req, res, status = 200, error = null, values = {}) {
    return res.status(status).render('checkout', {
        user: req.user,
        values,
        checkoutKey: req.session.checkoutKey,
        error,
        cartItems: values.cartItems || [],
        totals: values.totals || { subtotal: 0, discount: 0, deliveryFee: DELIVERY_FEE, total: 0 },
    });
}
function validateAddress(body) {
    const value = {};
    for (const field of ['customerName', 'phone', 'address', 'city', 'state', 'postalCode']) {
        value[field] = typeof body[field] === 'string' ? body[field].trim() : '';
    }
    if (value.customerName.length < 3 || value.customerName.length > 80) return { error: 'Enter a customer name between 3 and 80 characters.' };
    if (!/^\+?[\d()\s-]{10,20}$/.test(value.phone)) return { error: 'Enter a valid phone number with 10 to 15 digits.' };
    const phoneDigits = value.phone.replace(/\D/g, '');
    if (!/^\d{10,15}$/.test(phoneDigits)) return { error: 'Enter a valid phone number with 10 to 15 digits.' };
    value.phone = phoneDigits;
    if (value.address.length < 5 || value.address.length > 300) return { error: 'Enter a delivery address between 5 and 300 characters.' };
    if (!/^[\p{L}\p{N} .'-]{2,80}$/u.test(value.city)) return { error: 'Enter a valid city.' };
    if (!/^[\p{L}\p{N} .'-]{2,80}$/u.test(value.state)) return { error: 'Enter a valid state.' };
    if (!/^[\p{L}\p{N} -]{4,12}$/u.test(value.postalCode)) return { error: 'Enter a valid postal code.' };
    return { value };
}
function validKey(value) { return typeof value === 'string' && /^[a-f0-9-]{32,80}$/i.test(value); }
function productAvailable(product, quantity) {
    const stockQuantity = Number.isInteger(product?.stockQuantity) ? product.stockQuantity : 1;
    return product && (product.availability || 'in-stock') === 'in-stock' &&
        stockQuantity >= quantity && quantity >= 1;
}

async function loadSummary(userId) {
    const cart = await Cart.findOne({ userId });
    if (!cart || !cart.items.length) return { error: 'Your cart is empty.' };
    const ids = cart.items.map((item) => item.productId);
    if (ids.some((id) => !mongoose.isValidObjectId(id))) return { error: 'Your cart contains an invalid product. Review your cart and try again.' };
    const products = await Product.find({ _id: { $in: ids } }).lean();
    const byId = new Map(products.map((product) => [String(product._id), product]));
    const items = [];
    let subtotalCents = 0;
    let discountCents = 0;
    for (const cartItem of cart.items) {
        const product = byId.get(String(cartItem.productId));
        if (!product) return { error: 'A product in your cart is no longer available. Review your cart and try again.' };
        if (!Number.isSafeInteger(cartItem.quantity) || cartItem.quantity < 1) return { error: 'A cart quantity is invalid. Review your cart and try again.' };
        if (!productAvailable(product, cartItem.quantity)) return { error: `${product.name} is unavailable or has insufficient stock. Update your cart before checking out.` };
        const price = priceFor(product);
        const lineSubtotal = price.regularCents * cartItem.quantity;
        const lineDiscount = (price.regularCents - price.unitCents) * cartItem.quantity;
        subtotalCents += lineSubtotal;
        discountCents += lineDiscount;
        items.push({
            product,
            productId: product._id,
            name: product.name,
            image: product.image,
            imageContentType: product.imageContentType,
            quantity: cartItem.quantity,
            regularUnitPrice: dollars(price.regularCents),
            unitPrice: dollars(price.unitCents),
            discount: price.regularCents ? Math.round((price.regularCents - price.unitCents) / price.regularCents * 10000) / 100 : 0,
            lineTotal: dollars(price.unitCents * cartItem.quantity),
        });
    }
    return {
        cart,
        items,
        totals: {
            subtotal: dollars(subtotalCents),
            discount: dollars(discountCents),
            deliveryFee: DELIVERY_FEE,
            total: dollars(subtotalCents - discountCents + cents(DELIVERY_FEE)),
        },
    };
}

module.exports.showCheckout = async (req, res) => {
    try {
        if (!req.session.checkoutKey) req.session.checkoutKey = crypto.randomUUID();
        const summary = await loadSummary(req.user._id);
        if (summary.error) return renderCheckout(req, res, 400, summary.error);
        return renderCheckout(req, res, 200, null, { cartItems: summary.items, totals: summary.totals });
    } catch (error) {
        console.error('[orders] checkout page failed', { name: error.name });
        return renderCheckout(req, res, 503, 'Checkout is temporarily unavailable. Please try again shortly.');
    }
};

module.exports.placeOrder = async (req, res) => {
    const key = req.body?.idempotencyKey;
    if (!validKey(key)) return res.status(400).send('Checkout expired. Please return to checkout and try again.');
    try {
        const existing = await Order.findOne({ customerId: req.user._id, idempotencyKey: key });
        if (existing) {
            if (existing.placementStatus === 'placed') return res.redirect(303, `/orders/${existing._id}/confirmation`);
            return res.status(409).send('This checkout is already being processed. Please check your order history shortly.');
        }
        const addressResult = validateAddress(req.body || {});
        if (addressResult.error) {
            req.session.checkoutKey = crypto.randomUUID();
            const summary = await loadSummary(req.user._id);
            return renderCheckout(req, res, 400, addressResult.error, summary.error ? {} : {
                ...addressResult.value,
                cartItems: summary.items,
                totals: summary.totals,
            });
        }
        if (req.body.paymentMethod !== 'cash-on-delivery') {
            req.session.checkoutKey = crypto.randomUUID();
            const summary = await loadSummary(req.user._id);
            return renderCheckout(req, res, 400, 'Choose cash on delivery to place this order.', summary.error ? {} : {
                ...addressResult.value, cartItems: summary.items, totals: summary.totals,
            });
        }

        const summary = await loadSummary(req.user._id);
        if (summary.error) {
            req.session.checkoutKey = crypto.randomUUID();
            return renderCheckout(req, res, 400, summary.error);
        }
        const order = new Order({
            customerId: req.user._id,
            idempotencyKey: key,
            placementStatus: 'processing',
            items: summary.items.map(({ productId, name, image, imageContentType, quantity, regularUnitPrice, unitPrice, discount }) => ({
                productId, name, image, imageContentType, quantity, regularUnitPrice, unitPrice, discount,
            })),
            subtotal: summary.totals.subtotal,
            discount: summary.totals.discount,
            deliveryFee: summary.totals.deliveryFee,
            total: summary.totals.total,
            deliveryAddress: addressResult.value,
            paymentMethod: 'cash-on-delivery',
            paymentStatus: 'pending',
            status: 'placed',
        });
        await order.save();

        const decremented = [];
        let cartCleared = false;
        let cartForRestore = null;
        try {
            for (const item of summary.items) {
                const product = await Product.findOneAndUpdate(
                    {
                        _id: item.productId,
                        price: item.product.price,
                        discountedPrice: item.product.discountedPrice ?? null,
                        ...(item.product.discount === undefined ? { discount: { $exists: false } } : { discount: item.product.discount }),
                        $and: [
                            { availability: { $in: ['in-stock', null] } },
                            item.quantity === 1
                                ? { $or: [{ stockQuantity: { $gte: 1 } }, { stockQuantity: { $exists: false } }] }
                                : { stockQuantity: { $gte: item.quantity } },
                        ],
                    },
                    [{ $set: { stockQuantity: { $subtract: [{ $ifNull: ['$stockQuantity', 1] }, item.quantity] } } }],
                    { returnDocument: 'after', updatePipeline: true },
                );
                if (!product) throw Object.assign(new Error('insufficient-stock'), { safeCheckoutError: `${item.name} no longer has enough stock. Your cart is unchanged.` });
                decremented.push(item);
            }
            const currentCart = await Cart.findOne({ userId: req.user._id });
            const sameItems = currentCart && currentCart.items.length === summary.cart.items.length &&
                currentCart.items.every((item, index) => String(item.productId) === String(summary.cart.items[index].productId) && item.quantity === summary.cart.items[index].quantity);
            if (!sameItems || currentCart.__v !== summary.cart.__v) {
                throw Object.assign(new Error('cart-changed'), { safeCheckoutError: 'Your cart changed during checkout. Please review it and try again.' });
            }
            currentCart.items = [];
            await currentCart.save();
            cartCleared = true;
            cartForRestore = currentCart;
            order.placementStatus = 'placed';
            await order.save();
            delete req.session.checkoutKey;
            return res.redirect(303, `/orders/${order._id}/confirmation`);
        } catch (error) {
            if (cartCleared && cartForRestore) {
                try {
                    cartForRestore.items = summary.cart.items.map((item) => ({ productId: item.productId, quantity: item.quantity }));
                    await cartForRestore.save();
                } catch (restoreError) {
                    console.error('[orders] cart rollback failed', { name: restoreError.name });
                }
            }
            for (const item of decremented.reverse()) {
                try { await Product.updateOne({ _id: item.productId }, { $inc: { stockQuantity: item.quantity } }); }
                catch (rollbackError) { console.error('[orders] inventory rollback failed', { productId: String(item.productId), name: rollbackError.name }); }
            }
            order.placementStatus = 'failed';
            await order.save().catch((saveError) => console.error('[orders] failed placement state could not be saved', { name: saveError.name }));
            delete req.session.checkoutKey;
            if (error.safeCheckoutError) {
                const refreshed = await loadSummary(req.user._id).catch(() => null);
                return renderCheckout(req, res, 409, error.safeCheckoutError, refreshed && !refreshed.error ? {
                    ...addressResult.value, cartItems: refreshed.items, totals: refreshed.totals,
                } : {});
            }
            throw error;
        }
    } catch (error) {
        if (error.code === 11000) {
            const duplicate = await Order.findOne({ customerId: req.user._id, idempotencyKey: key });
            if (duplicate?.placementStatus === 'placed') return res.redirect(303, `/orders/${duplicate._id}/confirmation`);
            return res.status(409).send('This checkout is already being processed. Please check your order history shortly.');
        }
        console.error('[orders] order placement failed', { name: error.name, code: error.code, message: String(error.message || '').slice(0, 240) });
        return res.status(503).send('Unable to place your order right now. Your cart has been kept. Please try again.');
    }
};

module.exports.confirmation = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Order not found.');
    try {
        const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id, placementStatus: 'placed' }).lean();
        if (!order) return res.status(404).send('Order not found.');
        return res.render('order-confirmation', { order });
    } catch (error) { return res.status(503).send('Order details are temporarily unavailable.'); }
};

module.exports.history = async (req, res) => {
    try {
        const orders = await Order.find({ customerId: req.user._id, placementStatus: 'placed' }).sort({ createdAt: -1 }).lean();
        return res.render('order-history', { orders, error: null });
    } catch (error) { return res.status(503).render('order-history', { orders: [], error: 'Order history is temporarily unavailable.' }); }
};

module.exports.detail = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Order not found.');
    try {
        const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id, placementStatus: 'placed' }).lean();
        if (!order) return res.status(404).send('Order not found.');
        return res.render('order-detail', { order });
    } catch (error) { return res.status(503).send('Order details are temporarily unavailable.'); }
};

module.exports.ownerList = async (req, res) => {
    try {
        const orders = await Order.find({ placementStatus: 'placed' }).sort({ createdAt: -1 }).lean();
        return res.render('owner-orders', { orders, error: null });
    } catch (error) { return res.status(503).render('owner-orders', { orders: [], error: 'Orders are temporarily unavailable.' }); }
};

module.exports.ownerDetail = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Order not found.');
    try {
        const order = await Order.findOne({ _id: req.params.id, placementStatus: 'placed' }).lean();
        if (!order) return res.status(404).send('Order not found.');
        return res.render('owner-order-detail', { order, allowedStatuses: transitions[order.status] || [], error: null, success: req.flash('success') });
    } catch (error) { return res.status(503).send('Order details are temporarily unavailable.'); }
};

module.exports.updateStatus = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Order not found.');
    const next = req.body?.status;
    try {
        const order = await Order.findOne({ _id: req.params.id, placementStatus: 'placed' });
        if (!order) return res.status(404).send('Order not found.');
        if (!transitions[order.status]?.includes(next)) return res.status(400).send('That order status transition is not allowed.');
        if (next === 'cancelled') {
            const restored = [];
            try {
                for (const item of order.items) {
                    await Product.updateOne({ _id: item.productId }, { $inc: { stockQuantity: item.quantity } });
                    restored.push(item);
                }
                const updated = await Order.findOneAndUpdate(
                    { _id: order._id, placementStatus: 'placed', status: order.status },
                    { $set: { status: next } },
                    { returnDocument: 'after' },
                );
                if (!updated) throw Object.assign(new Error('order-status-conflict'), { statusConflict: true });
            } catch (error) {
                for (const item of restored.reverse()) {
                    await Product.updateOne({ _id: item.productId, stockQuantity: { $gte: item.quantity } }, { $inc: { stockQuantity: -item.quantity } })
                        .catch((rollbackError) => console.error('[orders] cancellation rollback failed', { name: rollbackError.name }));
                }
                if (error.statusConflict) return res.status(409).send('This order changed in another request. Refresh and try again.');
                throw error;
            }
        } else {
            const updated = await Order.findOneAndUpdate(
                { _id: order._id, placementStatus: 'placed', status: order.status },
                { $set: { status: next } },
                { returnDocument: 'after' },
            );
            if (!updated) return res.status(409).send('This order changed in another request. Refresh and try again.');
        }
        req.flash('success', 'Order status updated.');
        return res.redirect(303, `/owners/orders/${order._id}`);
    } catch (error) { return res.status(503).send('Unable to update this order right now.'); }
};
