const mongoose = require('mongoose');

const imageSchema = new mongoose.Schema({
    data: { type: Buffer, required: true },
    contentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
}, { _id: false });

const productSchema = mongoose.Schema({
    // `image` and `imageContentType` remain the primary image for existing
    // records and callers; `images` contains additional gallery images.
    image: { type: Buffer, required: true },
    imageContentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
    images: { type: [imageSchema], default: [] },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    description: { type: String, default: '', trim: true, maxlength: 3000 },
    price: { type: Number, required: true, min: 0.01, max: 10000000 },
    discountedPrice: {
        type: Number,
        min: 0.01,
        max: 10000000,
        validate: {
            validator(value) { return value == null || value < this.price; },
            message: 'Discounted price must be lower than regular price.',
        },
    },
    discount: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
    },
    category: { type: String, default: 'Other', trim: true, minlength: 2, maxlength: 60 },
    material: { type: String, default: 'Not specified', trim: true, minlength: 2, maxlength: 80 },
    colour: { type: String, default: 'Not specified', trim: true, minlength: 2, maxlength: 60 },
    dimensions: { type: String, default: '', trim: true, maxlength: 80 },
    capacity: { type: String, default: '', trim: true, maxlength: 60 },
    weight: { type: Number, min: 0.01, max: 50000 },
    features: { type: [String], default: [] },
    careInstructions: { type: String, default: '', trim: true, maxlength: 1200 },
    warranty: { type: String, default: '', trim: true, maxlength: 240 },
    stockQuantity: { type: Number, default: 1, min: 0, max: 1000000, validate: Number.isInteger },
    availability: { type: String, enum: ['in-stock', 'out-of-stock', 'preorder'], default: 'in-stock' },
    bgColor: { type: String, required: true, match: /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/ },
    panelColor: { type: String, required: true, match: /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/ },
    textColor: { type: String, required: true, match: /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/ },
    isNewCollection: { type: Boolean, default: false, index: true },
    isFeatured: { type: Boolean, default: false, index: true },
}, { timestamps: true });

productSchema.index({ createdAt: -1 });
productSchema.index({ discount: -1 });

module.exports = mongoose.model('product', productSchema)
