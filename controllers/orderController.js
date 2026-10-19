const crypto = require('node:crypto');
const mongoose = require('mongoose');
const Cart = require('../models/cart-model');
const Product = require('../models/product-model');
const Order = require('../models/order-model');

const DELIVERY_FEE = 0;
const MAX_ORDER_IMAGE_BYTES = 12 * 1024 * 1024;
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

async function loadSummary(userId, session = null) {
    let cartQuery = Cart.findOne({ userId });
    if (session) cartQuery = cartQuery.session(session);
    const cart = await cartQuery;
    if (!cart || !cart.items.length) return { error: 'Your cart is empty.' };
    const ids = cart.items.map((item) => item.productId);
    if (ids.some((id) => !mongoose.isValidObjectId(id))) return { error: 'Your cart contains an invalid product. Review your cart and try again.' };
    let productQuery = Product.find({ _id: { $in: ids } });
    if (session) productQuery = productQuery.session(session);
    const products = await productQuery.lean();
    const byId = new Map(products.map((product) => [String(product._id), product]));
    const items = [];
    let subtotalCents = 0;
    let discountCents = 0;
    let imageBytes = 0;
    for (const cartItem of cart.items) {
        const product = byId.get(String(cartItem.productId));
        if (!product) return { error: 'A product in your cart is no longer available. Review your cart and try again.' };
        if (!Number.isSafeInteger(cartItem.quantity) || cartItem.quantity < 1) return { error: 'A cart quantity is invalid. Review your cart and try again.' };
        if (!productAvailable(product, cartItem.quantity)) return { error: `${product.name} is unavailable or has insufficient stock. Update your cart before checking out.` };
        const price = priceFor(product);
        imageBytes += Buffer.isBuffer(product.image) ? product.image.length : 0;
        if (imageBytes > MAX_ORDER_IMAGE_BYTES) {
            return { error: 'The images in this cart exceed the order size limit. Remove an item or contact the store for help.' };
        }
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

function transactionsUnavailable(error) {
    return error?.code === 20 || error?.codeName === 'IllegalOperation' ||
        /transaction numbers are only allowed|transactions? (?:are )?not supported|replica set or mongos/i.test(String(error?.message || ''));
}

function logOrderFailure(operation, error) {
    console.error(`[orders] ${operation} failed`, {
        name: error?.name || 'Error',
        ...(Number.isInteger(error?.code) ? { code: error.code } : {}),
    });
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
    const addressResult = validateAddress(req.body || {});
    if (addressResult.error) {
        req.session.checkoutKey = crypto.randomUUID();
        const summary = await loadSummary(req.user._id).catch(() => null);
        return renderCheckout(req, res, 400, addressResult.error, summary && !summary.error ? {
            ...addressResult.value, cartItems: summary.items, totals: summary.totals,
        } : {});
    }
    if (req.body.paymentMethod !== 'cash-on-delivery') {
        req.session.checkoutKey = crypto.randomUUID();
        const summary = await loadSummary(req.user._id).catch(() => null);
        return renderCheckout(req, res, 400, 'Choose cash on delivery to place this order.', summary && !summary.error ? {
            ...addressResult.value, cartItems: summary.items, totals: summary.totals,
        } : {});
    }

    let session;
    let transactionResult = null;
    try {
        session = await mongoose.startSession();
        await session.withTransaction(async () => {
            const existing = await Order.findOne({ customerId: req.user._id, idempotencyKey: key }).session(session);
            if (existing) {
                transactionResult = existing.placementStatus === 'placed'
                    ? { order: existing }
                    : { conflict: true };
                return;
            }

            const summary = await loadSummary(req.user._id, session);
            if (summary.error) {
                transactionResult = { validationError: summary.error };
                return;
            }

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
                    { session, returnDocument: 'after', updatePipeline: true },
                );
                if (!product) {
                    transactionResult = { validationError: `${item.name} no longer has enough stock. Your cart is unchanged.` };
                    throw Object.assign(new Error('checkout-validation-failed'), { safeCheckoutValidation: true });
                }
            }
            const cartFilter = { _id: summary.cart._id };
            if (Number.isInteger(summary.cart.__v)) cartFilter.__v = summary.cart.__v;
            else cartFilter.__v = { $exists: false };
            const cartUpdate = { $set: { items: [] } };
            if (Number.isInteger(summary.cart.__v)) cartUpdate.$inc = { __v: 1 };
            else cartUpdate.$set.__v = 1;
            const clearedCart = await Cart.updateOne(cartFilter, cartUpdate, { session });
            if (clearedCart.matchedCount !== 1) {
                transactionResult = { conflict: true };
                throw Object.assign(new Error('cart-changed'), { safeCheckoutConflict: true });
            }

            const [order] = await Order.create([{
                customerId: req.user._id,
                idempotencyKey: key,
                placementStatus: 'placed',
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
            }], { session });
            transactionResult = { order };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });

        if (transactionResult?.validationError) {
            req.session.checkoutKey = crypto.randomUUID();
            const summary = await loadSummary(req.user._id).catch(() => null);
            return renderCheckout(req, res, 409, transactionResult.validationError, summary && !summary.error ? {
                ...addressResult.value, cartItems: summary.items, totals: summary.totals,
            } : {});
        }
        if (transactionResult?.conflict) return res.status(409).send('Your cart or checkout changed during processing. Please review your cart and try again.');
        if (transactionResult?.order) {
            delete req.session.checkoutKey;
            return res.redirect(303, `/orders/${transactionResult.order._id}/confirmation`);
        }
        throw new Error('checkout-transaction-did-not-complete');
    } catch (error) {
        if (transactionsUnavailable(error)) {
            logOrderFailure('MongoDB transaction requirement', error);
            return res.status(503).send('Checkout is unavailable because this MongoDB server does not support transactions. Configure a replica set or MongoDB Atlas and try again. Your cart and stock are unchanged.');
        }
        if (error.safeCheckoutValidation) {
            req.session.checkoutKey = crypto.randomUUID();
            const summary = await loadSummary(req.user._id).catch(() => null);
            return renderCheckout(req, res, 409, transactionResult.validationError, summary && !summary.error ? {
                ...addressResult.value, cartItems: summary.items, totals: summary.totals,
            } : {});
        }
        if (error.code === 11000) {
            const duplicate = await Order.findOne({ customerId: req.user._id, idempotencyKey: key });
            if (duplicate?.placementStatus === 'placed') return res.redirect(303, `/orders/${duplicate._id}/confirmation`);
            return res.status(409).send('This checkout is already being processed. Please check your order history shortly.');
        }
        logOrderFailure('order placement', error);
        return res.status(503).send('Unable to place your order right now. Your cart has been kept. Please try again.');
    } finally {
        if (session) await session.endSession();
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
    let session;
    try {
        session = await mongoose.startSession();
        let result = null;
        await session.withTransaction(async () => {
            const order = await Order.findOne({ _id: req.params.id, placementStatus: 'placed' }).session(session);
            if (!order) {
                result = { notFound: true };
                return;
            }
            if (!transitions[order.status]?.includes(next)) {
                result = { invalidTransition: true };
                return;
            }
            if (next === 'cancelled') {
                for (const item of order.items) {
                    await Product.updateOne({ _id: item.productId }, { $inc: { stockQuantity: item.quantity } }, { session });
                }
            }
            const updated = await Order.findOneAndUpdate(
                { _id: order._id, placementStatus: 'placed', status: order.status },
                { $set: { status: next } },
                { session, returnDocument: 'after' },
            );
            if (!updated) throw Object.assign(new Error('order-status-conflict'), { statusConflict: true });
            result = { orderId: order._id };
        }, { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, readPreference: 'primary' });
        if (result?.notFound) return res.status(404).send('Order not found.');
        if (result?.invalidTransition) return res.status(400).send('That order status transition is not allowed.');
        req.flash('success', 'Order status updated.');
        return res.redirect(303, `/owners/orders/${result.orderId}`);
    } catch (error) {
        if (transactionsUnavailable(error)) {
            logOrderFailure('MongoDB transaction requirement', error);
            return res.status(503).send('Order updates are unavailable because this MongoDB server does not support transactions. Configure a replica set or MongoDB Atlas and try again.');
        }
        if (error.statusConflict) return res.status(409).send('This order changed in another request. Refresh and try again.');
        logOrderFailure('order status update', error);
        return res.status(503).send('Unable to update this order right now.');
    } finally {
        if (session) await session.endSession();
    }
};
