const mongoose = require('mongoose');


const productSchema = mongoose.Schema({
    image: { type: Buffer, required: true },
    imageContentType: { type: String, enum: ['image/jpeg', 'image/png', 'image/webp'], required: true },
    name: { type: String, required: true, trim: true, minlength: 2, maxlength: 120 },
    price: { type: Number, required: true, min: 0.01, max: 10000000 },
    discount: {
        type: Number,
        default: 0,
        min: 0,
        max: 100,
    },
    bgColor: { type: String, required: true, match: /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/ },
    panelColor: { type: String, required: true, match: /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/ },
    textColor: { type: String, required: true, match: /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/ },
    isNewCollection: { type: Boolean, default: false, index: true },
}, { timestamps: true });

productSchema.index({ createdAt: -1 });
productSchema.index({ discount: -1 });

module.exports = mongoose.model('product', productSchema)
