const mongoose = require('mongoose');
const Product = require('../models/product-model');

const maxImagePixels = 40000000;

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

function productInput(body, file, existing) {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const price = body.price === '' || body.price === undefined ? NaN : Number(body.price);
    const discount = body.discount === '' || body.discount === undefined ? 0 : Number(body.discount);
    const bgColor = typeof (body.bgColor ?? body.bgcolor) === 'string' ? (body.bgColor ?? body.bgcolor).trim() : '';
    const panelColor = typeof (body.panelColor ?? body.panelcolor) === 'string' ? (body.panelColor ?? body.panelcolor).trim() : '';
    const textColor = typeof (body.textColor ?? body.textcolor) === 'string' ? (body.textColor ?? body.textcolor).trim() : '';
    const colorPattern = /^(#[0-9a-fA-F]{3,8}|[a-zA-Z]{1,24})$/;

    if (name.length < 2 || name.length > 120) return { error: 'Product name must be 2 to 120 characters.' };
    if (!Number.isFinite(price) || price < 0.01 || price > 10000000) return { error: 'Enter a valid price greater than zero.' };
    if (!Number.isFinite(discount) || discount < 0 || discount > 100) return { error: 'Discount must be between 0 and 100 percent.' };
    if (![bgColor, panelColor, textColor].every((color) => colorPattern.test(color))) {
        return { error: 'Use a simple color name or a hexadecimal color value.' };
    }
    if (file && !hasValidImage(file)) return { error: 'The uploaded file does not match a supported image type.' };
    if (!file && !existing) return { error: 'Please select a JPEG, PNG, or WebP product image.' };

    return {
        value: {
            name,
            price,
            discount,
            bgColor,
            panelColor,
            textColor,
            isNewCollection: ['on', 'true', '1'].includes(String(body.isNewCollection || '').toLowerCase()),
            ...(file ? { image: file.buffer, imageContentType: file.mimetype } : {}),
        },
    };
}

function notFoundProduct(res) {
    return res.status(404).render('product-detail', { product: null, error: 'Product not found.' });
}

module.exports.listProducts = async (req, res) => {
    const filter = ['new', 'discounted'].includes(req.query.filter) ? req.query.filter : 'all';
    const sortby = ['newest', 'price-low', 'price-high'].includes(req.query.sortby) ? req.query.sortby : 'newest';
    const query = filter === 'new' ? { isNewCollection: true } : filter === 'discounted' ? { discount: { $gt: 0 } } : {};
    const sort = sortby === 'price-low' ? { price: 1, createdAt: -1 }
        : sortby === 'price-high' ? { price: -1, createdAt: -1 }
            : { createdAt: -1, _id: -1 };

    try {
        const products = await Product.find(query).sort(sort).lean();
        return res.render('shop', { products, filter, sortby, error: null });
    } catch (error) {
        return res.status(503).render('shop', {
            products: [],
            filter,
            sortby,
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
    const input = productInput(req.body || {}, req.file, null);
    if (input.error) return res.status(400).send(input.error);
    try {
        await Product.create(input.value);
        req.flash('success', 'Product created successfully.');
        return res.redirect('/owners/admin');
    } catch (error) {
        if (error.name === 'ValidationError') return res.status(400).send('Please check the product details and try again.');
        return res.status(500).send('Unable to create this product right now.');
    }
};

module.exports.updateProduct = async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return notFoundProduct(res);
    try {
        const existing = await Product.findById(req.params.id);
        if (!existing) return notFoundProduct(res);
        const input = productInput(req.body || {}, req.file, existing);
        if (input.error) return res.status(400).send(input.error);

        Object.assign(existing, input.value);
        await existing.save();
        req.flash('success', 'Product updated successfully.');
        return res.redirect('/owners/admin');
    } catch (error) {
        if (error.name === 'ValidationError') return res.status(400).send('Please check the product details and try again.');
        return res.status(500).send('Unable to update this product right now.');
    }
};

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
