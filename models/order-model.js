const mongoose = require('mongoose');

const orderItemSchema = new mongoose.Schema({
    productId: { type: mongoose.Schema.Types.ObjectId, ref: 'product', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    image: { type: Buffer, required: true },
    imageContentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
    quantity: { type: Number, required: true, min: 1, validate: Number.isInteger },
    regularUnitPrice: { type: Number, required: true, min: 0 },
    unitPrice: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0, max: 100 },
}, { _id: false });

const addressSchema = new mongoose.Schema({
    customerName: { type: String, required: true, trim: true, maxlength: 80 },
    phone: { type: String, required: true, trim: true, maxlength: 20 },
    address: { type: String, required: true, trim: true, maxlength: 300 },
    city: { type: String, required: true, trim: true, maxlength: 80 },
    state: { type: String, required: true, trim: true, maxlength: 80 },
    postalCode: { type: String, required: true, trim: true, maxlength: 12 },
}, { _id: false });

const orderSchema = new mongoose.Schema({
    customerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    idempotencyKey: { type: String, required: true, minlength: 32, maxlength: 80 },
    placementStatus: { type: String, enum: ['processing', 'placed', 'failed'], default: 'processing', required: true },
    items: { type: [orderItemSchema], required: true, validate: (items) => items.length > 0 },
    subtotal: { type: Number, required: true, min: 0 },
    discount: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, required: true, min: 0, default: 0 },
    total: { type: Number, required: true, min: 0 },
    deliveryAddress: { type: addressSchema, required: true },
    paymentMethod: { type: String, enum: ['cash-on-delivery'], required: true, default: 'cash-on-delivery' },
    paymentStatus: { type: String, enum: ['pending', 'paid'], required: true, default: 'pending' },
    status: { type: String, enum: ['placed', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'], required: true, default: 'placed' },
}, { timestamps: true });

orderSchema.index({ customerId: 1, idempotencyKey: 1 }, { unique: true });
orderSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Order', orderSchema);
