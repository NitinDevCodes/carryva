const mongoose = require('mongoose');
const Product = require('../models/product-model');

const maxImagePixels = 40000000;
const maxProductImages = 6;
const maxBsonDocumentBytes = 16 * 1024 * 1024;
const reservedProductDocumentBytes = 4 * 1024 * 1024;
const maxProductImageDataUriBytes = maxBsonDocumentBytes - reservedProductDocumentBytes;
const dataUriPrefix = (contentType) => `data:${contentType};base64,`;

function productImageDataUriBytes(file) {
    if (!Number.isSafeInteger(file?.size) || file.size < 0 || typeof file.mimetype !== 'string') return Infinity;
    return 4 * Math.ceil(file.size / 3) + Buffer.byteLength(dataUriPrefix(file.mimetype));
}

function validateProductImageSize(files) {
    const dataUriBytes = files.reduce((total, file) => total + productImageDataUriBytes(file), 0);
    if (dataUriBytes > maxProductImageDataUriBytes) {
        return 'Combined product images are too large. Their base64 display size must be 12 MiB or less to leave room under MongoDB’s 16 MiB document limit.';
    }
    return null;
}

function isBsonDocumentTooLarge(error) {
    return error?.code === 10334 || error?.codeName === 'BSONObjectTooLarge';
}

function dimensionsAreSafe(width, height) {
    return width > 0 && height > 0 && width <= 12000 && height <= 12000 && width * height <= maxImagePixels;
}

function validPng(buffer) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.length < 33 || !buffer.subarray(0, 8).equals(signature) || buffer.toString('ascii', 12, 16) !== 'IHDR') return false;
    if (!buffer.includes(Buffer.from('IDAT')) || !buffer.includes(Buffer.from('IEND'))) return false;
    return dimensionsAreSafe(buffer.readUInt32BE(16), buffer.readUInt32BE(20));
}

function validJpeg(buffer) {
    if (buffer.length < 16 || buffer[0] !== 0xff || buffer[1] !== 0xd8 || buffer.at(-2) !== 0xff || buffer.at(-1) !== 0xd9) return false;
    const frameMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
    let offset = 2;
    while (offset + 4 < buffer.length) {
        if (buffer[offset] !== 0xff) return false;
        while (buffer[offset] === 0xff) offset += 1;
        const marker = buffer[offset++];
        if (marker === 0xda || marker === 0xd9) return false;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        if (offset + 2 > buffer.length) return false;
        const segmentLength = buffer.readUInt16BE(offset);
        if (segmentLength < 2 || offset + segmentLength > buffer.length) return false;
        if (frameMarkers.has(marker)) {
            if (segmentLength < 7) return false;
            return dimensionsAreSafe(buffer.readUInt16BE(offset + 3), buffer.readUInt16BE(offset + 5));
        }
        offset += segmentLength;
    }
    return false;
}

function validWebp(buffer) {
    if (buffer.length < 30 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WEBP') return false;
    if (buffer.readUInt32LE(4) + 8 !== buffer.length) return false;
    const chunk = buffer.toString('ascii', 12, 16);
    let width;
    let height;
    if (chunk === 'VP8X' && buffer.length >= 30) {
        width = 1 + buffer.readUIntLE(24, 3);
        height = 1 + buffer.readUIntLE(27, 3);
    } else if (chunk === 'VP8 ' && buffer.length >= 30 && buffer.toString('hex', 23, 26) === '9d012a') {
        width = buffer.readUInt16LE(26) & 0x3fff;
        height = buffer.readUInt16LE(28) & 0x3fff;
    } else if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) {
        const b1 = buffer[21], b2 = buffer[22], b3 = buffer[23], b4 = buffer[24];
        width = 1 + (((b2 & 0x3f) << 8) | b1);
        height = 1 + (((b4 & 0x0f) << 10) | (b3 << 2) | ((b2 & 0xc0) >> 6));
    } else {
        return false;
    }
    return dimensionsAreSafe(width, height);
}

const imageValidators = {
    'image/jpeg': validJpeg,
    'image/png': validPng,
    'image/webp': validWebp,
};

function hasValidImage(file) {
    return Boolean(file && file.buffer && imageValidators[file.mimetype]?.(file.buffer));
}

function productImages(req) {
    return [...(req.files?.images || []), ...(req.files?.image || [])];
}

function productInput(body, files, existing) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const price = body.price === '' || body.price === undefined ? NaN : Number(body.price);
    const hasDiscountedPrice = Object.hasOwn(body, 'discountedPrice');
    const requestedDiscountedPrice = body.discountedPrice === '' || body.discountedPrice === undefined
        ? undefined
        : Number(body.discountedPrice);
    const requestedDiscount = body.discount === '' || body.discount === undefined ? 0 : Number(body.discount);
    let discount = requestedDiscount;
    let discountedPrice;
    if (hasDiscountedPrice) {
        if (requestedDiscountedPrice === undefined) {
            discount = 0;
        } else {
            if (!Number.isFinite(requestedDiscountedPrice) || requestedDiscountedPrice < 0.01 || requestedDiscountedPrice >= price) {
                return { error: 'Discounted price must be greater than zero and lower than the regular price.' };
            }
            discountedPrice = requestedDiscountedPrice;
            discount = Math.min(99.99, Math.round((1 - discountedPrice / price) * 10000) / 100);
        }
    } else if (Number.isFinite(price) && Number.isFinite(requestedDiscount) && requestedDiscount > 0) {
        discountedPrice = Math.round(price * (1 - requestedDiscount / 100) * 100) / 100;
    }
    const bgColor = typeof (body.bgColor ?? body.bgcolor) === 'string' ? (body.bgColor ?? body.bgcolor).trim() : '';
    const panelColor = typeof (body.panelColor ?? body.panelcolor) === 'string' ? (body.panelColor ?? body.panelcolor).trim() : '';
    const textColor = typeof (body.textColor ?? body.textcolor) === 'string' ? (body.textColor ?? body.textcolor).trim() : '';
    const colorPattern = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/;

    if (name.length < 2 || name.length > 120) return { error: 'Product name must be 2 to 120 characters.' };
    if (description.length > 3000) return { error: 'Description must be 3000 characters or fewer.' };
    if (!Number.isFinite(price) || price < 0.01 || price > 10000000) return { error: 'Enter a valid price greater than zero.' };
    if (!Number.isFinite(discount) || discount < 0 || discount >= 100) return { error: 'Discount must be at least 0 and less than 100 percent.' };
    if (discountedPrice !== undefined && discountedPrice < 0.01) return { error: 'The discounted price must be at least ₹0.01.' };
    if (![bgColor, panelColor, textColor].every((color) => colorPattern.test(color))) {
        return { error: 'Use a simple color name or a hexadecimal color value.' };
    }
    const category = typeof body.category === 'string' ? body.category.trim() : '';
    const material = typeof body.material === 'string' ? body.material.trim() : '';
    const colour = typeof body.colour === 'string' ? body.colour.trim() : '';
    const dimensions = typeof body.dimensions === 'string' ? body.dimensions.trim() : '';
    const capacity = typeof body.capacity === 'string' ? body.capacity.trim() : '';
    const weight = body.weight === '' || body.weight === undefined ? undefined : Number(body.weight);
    const stockQuantity = body.stockQuantity === '' || body.stockQuantity === undefined ? NaN : Number(body.stockQuantity);
    const availability = typeof body.availability === 'string' ? body.availability : '';
    const careInstructions = typeof body.careInstructions === 'string' ? body.careInstructions.trim() : '';
    const warranty = typeof body.warranty === 'string' ? body.warranty.trim() : '';
    const rawFeatures = typeof body.features === 'string' ? body.features : '';
    const features = rawFeatures.split(/[\n,]/).map((feature) => feature.trim()).filter(Boolean);

    if (category.length < 2 || category.length > 60) return { error: 'Enter a product category between 2 and 60 characters.' };
    if (material.length < 2 || material.length > 80) return { error: 'Enter a material between 2 and 80 characters.' };
    if (colour.length < 2 || colour.length > 60) return { error: 'Enter a colour between 2 and 60 characters.' };
    if (dimensions.length > 80 || capacity.length > 60) return { error: 'Check the dimensions and capacity fields.' };
    if (weight !== undefined && (!Number.isFinite(weight) || weight <= 0 || weight > 50000)) return { error: 'Weight must be between 0 and 50000 grams.' };
    if (!Number.isInteger(stockQuantity) || stockQuantity < 0 || stockQuantity > 1000000) return { error: 'Stock quantity must be a whole number from 0 to 1000000.' };
    if (!['in-stock', 'out-of-stock', 'preorder'].includes(availability)) return { error: 'Choose a valid availability status.' };
    if (availability === 'in-stock' && stockQuantity === 0) return { error: 'Set stock above zero or choose another availability status.' };
    if (careInstructions.length > 1200 || warranty.length > 240) return { error: 'Care instructions or warranty text is too long.' };
    if (features.length > 20 || features.some((feature) => feature.length < 2 || feature.length > 120)) return { error: 'Add up to 20 features, each no longer than 120 characters.' };
    if (files.length > maxProductImages) return { error: `Upload no more than ${maxProductImages} product images.` };
    if (files.some((file) => !hasValidImage(file))) return { error: 'An uploaded file does not match a supported image type.' };
    const imageSizeError = validateProductImageSize(files);
    if (imageSizeError) return { error: imageSizeError, status: 413 };
    if (!files.length && !existing) return { error: 'Please select at least one JPEG, PNG, or WebP product image.' };

    const imageUpdates = files.length ? {
        image: files[0].buffer,
        imageContentType: files[0].mimetype,
        images: files.slice(1).map((file) => ({ data: file.buffer, contentType: file.mimetype })),
    } : {};

    return {
        value: {
            name,
            description,
            price,
            discount,
            discountedPrice,
            category,
            material,
            colour,
            dimensions,
            capacity,
            weight,
            features,
            careInstructions,
            warranty,
            stockQuantity,
            availability,
            bgColor,
            panelColor,
            textColor,
            isNewCollection: ['on', 'true', '1'].includes(String(body.isNewCollection || '').toLowerCase()),
            isFeatured: ['on', 'true', '1'].includes(String(body.isFeatured || '').toLowerCase()),
            ...imageUpdates,
        },
    };
}

function notFoundProduct(res) {
    return res.status(404).render('product-detail', { product: null, error: 'Product not found.' });
}

module.exports.listProducts = async (req, res) => {
    const filter = ['new', 'discounted'].includes(req.query.filter) ? req.query.filter : 'all';
    const sortby = ['newest', 'price-low', 'price-high'].includes(req.query.sortby) ? req.query.sortby : 'newest';
    const category = typeof req.query.category === 'string' && req.query.category.trim().length <= 60
        ? req.query.category.trim()
        : '';
    const query = {};
    if (filter === 'new') query.isNewCollection = true;
    if (filter === 'discounted') query.discount = { $gt: 0 };
    if (category) query.category = category;
    const sort = sortby === 'price-low' ? { price: 1, createdAt: -1 }
        : sortby === 'price-high' ? { price: -1, createdAt: -1 }
            : { createdAt: -1, _id: -1 };

    try {
        const products = await Product.find(query).sort(sort).lean();
        const categories = await Product.distinct('category');
        return res.render('shop', { products, filter, sortby, category, categories: categories.filter(Boolean).sort(), error: null });
    } catch (error) {
        return res.status(503).render('shop', {
            products: [],
            filter,
            sortby,
            category,
            categories: [],
            error: 'Products are temporarily unavailable. Please try again shortly.',
        });
    }
};

module.exports.showProduct = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return notFoundProduct(res);
    try {
        const product = await Product.findById(req.params.id).lean();
        if (!product) return notFoundProduct(res);
        return res.render('product-detail', { product, error: null });
    } catch (error) {
        return res.status(503).render('product-detail', {
            product: null,
            error: 'Product details are temporarily unavailable. Please try again shortly.',
        });
    }
};

module.exports.showAdminProducts = async (req, res) => {
    try {
        const products = await Product.find().sort({ createdAt: -1, _id: -1 }).lean();
        return res.render('admin', { products, success: req.flash('success'), error: null });
    } catch (error) {
        return res.status(503).render('admin', {
            products: [],
            success: req.flash('success'),
            error: 'Products are temporarily unavailable. Please try again shortly.',
        });
    }
};

module.exports.showCreateForm = (req, res) => {
    return res.render('createproducts', { product: null, success: req.flash('success'), error: null });
};

module.exports.showEditForm = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return notFoundProduct(res);
    try {
        const product = await Product.findById(req.params.id).lean();
        if (!product) return notFoundProduct(res);
        return res.render('createproducts', { product, success: req.flash('success'), error: null });
    } catch (error) {
        return res.status(503).render('createproducts', {
            product: null,
            success: [],
            error: 'Product details are temporarily unavailable. Please try again shortly.',
        });
    }
};

module.exports.createProduct = async (req, res) => {
    const input = productInput(req.body || {}, productImages(req), null);
    if (input.error) return res.status(input.status || 400).send(input.error);
    try {
        await Product.create(input.value);
        req.flash('success', 'Product created successfully.');
        return res.redirect('/owners/admin');
    } catch (error) {
        if (isBsonDocumentTooLarge(error)) return res.status(413).send('Product data exceeds MongoDB’s 16 MiB document limit. Reduce the image or text content and try again.');
        if (error.name === 'ValidationError') return res.status(400).send('Please check the product details and try again.');
        return res.status(500).send('Unable to create this product right now.');
    }
};

module.exports.updateProduct = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return notFoundProduct(res);
    try {
        const existing = await Product.findById(req.params.id);
        if (!existing) return notFoundProduct(res);
        const input = productInput(req.body || {}, productImages(req), existing);
        if (input.error) return res.status(input.status || 400).send(input.error);

        Object.assign(existing, input.value);
        await existing.save();
        req.flash('success', 'Product updated successfully.');
        return res.redirect('/owners/admin');
    } catch (error) {
        if (isBsonDocumentTooLarge(error)) return res.status(413).send('Product data exceeds MongoDB’s 16 MiB document limit. Reduce the image or text content and try again.');
        if (error.name === 'ValidationError') return res.status(400).send('Please check the product details and try again.');
        return res.status(500).send('Unable to update this product right now.');
    }
};

module.exports.validateProductImageSize = validateProductImageSize;
module.exports.maxProductImageDataUriBytes = maxProductImageDataUriBytes;
module.exports.productImageDataUriBytes = productImageDataUriBytes;

module.exports.deleteProduct = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return notFoundProduct(res);
    try {
        const deleted = await Product.findByIdAndDelete(req.params.id);
        if (!deleted) return notFoundProduct(res);
        req.flash('success', 'Product deleted successfully.');
        return res.redirect('/owners/admin');
    } catch (error) {
        return res.status(500).send('Unable to delete this product right now.');
    }
};
