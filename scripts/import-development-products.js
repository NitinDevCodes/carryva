if (process.env.NODE_ENV !== 'production') {
    require('dotenv').config({ override: true });
}

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const mongoose = require('mongoose');
const connection = require('../config/mongoose-connection');
const Product = require('../models/product-model');

// Names and prices are editable development-store examples. Unknown physical
// specifications remain explicitly unspecified or blank. Features below only
// describe details visible in the corresponding image.
const catalog = [
    {
        filename: '1bag.png', name: 'Everyday Navy Backpack', category: 'Backpack',
        description: 'A navy-toned backpack with a rounded silhouette, a top carry loop and a visible front zip pocket.',
        price: 2499, discountedPrice: 2199, colour: 'Navy blue', stockQuantity: 12,
        features: ['Top carry loop', 'Visible front zip pocket'], isFeatured: true,
        bgColor: '#e9edf2', panelColor: '#ffffff', textColor: '#172033',
    },
    {
        filename: '2bag.png', name: 'Classic Black Backpack', category: 'Backpack',
        description: 'A black backpack with a rounded profile, a top carry loop and a broad front pocket.',
        price: 2199, discountedPrice: 1949, colour: 'Black', stockQuantity: 10,
        features: ['Top carry loop', 'Visible front zip pocket'], isFeatured: false,
        bgColor: '#eeeeee', panelColor: '#ffffff', textColor: '#171717',
    },
    {
        filename: '3bag 1.png', name: 'Natural Everyday Tote', category: 'Tote',
        description: 'A light natural-coloured tote with two shoulder straps and a simple, flat front.',
        price: 899, discountedPrice: 799, colour: 'Natural ivory', stockQuantity: 16,
        features: ['Two shoulder straps'], isFeatured: true,
        bgColor: '#f2eee7', panelColor: '#ffffff', textColor: '#302a23',
    },
    {
        filename: '4bag.png', name: 'Chestnut Front-Pocket Backpack', category: 'Backpack',
        description: 'A chestnut-coloured backpack with a rounded top, a top carry handle and a visible front pocket.',
        price: 3299, discountedPrice: 2899, colour: 'Chestnut brown', stockQuantity: 8,
        features: ['Top carry handle', 'Visible front zip pocket'], isFeatured: true,
        bgColor: '#f2e9e5', panelColor: '#ffffff', textColor: '#3a2420',
    },
    {
        filename: '5bag.png', name: 'Charcoal Minimal Backpack', category: 'Backpack',
        description: 'A charcoal-coloured backpack with a clean, structured silhouette and understated front detailing.',
        price: 2799, discountedPrice: 2499, colour: 'Charcoal', stockQuantity: 9,
        features: ['Structured backpack silhouette'], isFeatured: false,
        bgColor: '#e9e9e9', panelColor: '#ffffff', textColor: '#252525',
    },
    {
        filename: '6bag.png', name: 'Tan Everyday Tote', category: 'Tote',
        description: 'A tan-coloured tote with two long shoulder straps and a simple rectangular shape.',
        price: 999, discountedPrice: 899, colour: 'Tan', stockQuantity: 14,
        features: ['Two long shoulder straps'], isFeatured: false,
        bgColor: '#f1e9dd', panelColor: '#ffffff', textColor: '#382d22',
    },
    {
        filename: '7bag.png', name: 'Textured Drawstring Pouch', category: 'Pouch',
        description: 'A light beige pouch with a gathered opening and a visible drawstring tie.',
        price: 499, discountedPrice: 449, colour: 'Beige', stockQuantity: 20,
        features: ['Gathered drawstring closure'], isFeatured: false,
        bgColor: '#f3eee2', panelColor: '#ffffff', textColor: '#342f25',
    },
    {
        filename: 'image 80.png', name: 'Cognac Travel Duffel', category: 'Duffel',
        description: 'A cognac-coloured duffel with two top handles and a visible shoulder strap.',
        price: 3899, discountedPrice: 3499, colour: 'Cognac brown', stockQuantity: 6,
        features: ['Two top handles', 'Visible shoulder strap'], isFeatured: true,
        bgColor: '#f1e7dc', panelColor: '#ffffff', textColor: '#39271c',
    },
].map((item) => ({ ...item, isNewCollection: true }));

function validatePng(buffer, filename) {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    if (buffer.length < 33 || buffer.length > 5 * 1024 * 1024 || !buffer.subarray(0, 8).equals(signature) ||
        buffer.toString('ascii', 12, 16) !== 'IHDR' || !buffer.includes(Buffer.from('IDAT')) || !buffer.includes(Buffer.from('IEND'))) {
        throw new Error(`Invalid or oversized PNG image: ${filename}`);
    }
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    if (!width || !height || width > 12000 || height > 12000 || width * height > 40000000) {
        throw new Error(`PNG dimensions are outside the supported range: ${filename}`);
    }
}

function stableId(filename) {
    return new mongoose.Types.ObjectId(crypto.createHash('sha256').update(`carryva-development-catalog:${filename}`).digest('hex').slice(0, 24));
}

async function importCatalog() {
    const imageDirectory = path.join(__dirname, '..', 'public', 'images');
    let imported = 0;
    let skipped = 0;
    const results = [];

    for (const item of catalog) {
        const imagePath = path.join(imageDirectory, item.filename);
        const image = fs.readFileSync(imagePath);
        validatePng(image, item.filename);
        const _id = stableId(item.filename);
        const existing = await Product.findById(_id).select('_id name image').lean();
        if (existing) {
            skipped += 1;
            results.push({ filename: item.filename, product: existing.name, result: 'already imported' });
            continue;
        }

        // Avoid introducing a second catalog entry if this exact source image
        // is already attached to a product created through the owner interface.
        const sameImage = await Product.findOne({ image }).select('_id name').lean();
        if (sameImage) {
            skipped += 1;
            results.push({ filename: item.filename, product: sameImage.name, result: 'image already represented' });
            continue;
        }

        const discount = Math.round((1 - item.discountedPrice / item.price) * 10000) / 100;
        await Product.create({
            _id,
            ...item,
            description: `${item.description} Material, dimensions, capacity, and weight are not specified.`,
            image,
            imageContentType: 'image/png',
            images: [],
            discount,
            material: 'Not specified',
            dimensions: '',
            capacity: '',
            careInstructions: 'Not specified',
            warranty: 'Not specified',
        });
        imported += 1;
        results.push({ filename: item.filename, product: item.name, result: 'imported' });
    }

    console.log(JSON.stringify({ database: mongoose.connection.name, imported, skipped, results }, null, 2));
}

connection.asPromise()
    .then(importCatalog)
    .then(() => mongoose.disconnect())
    .catch(async (error) => {
        console.error('Development catalog import failed.', {
            name: error.name || 'Error',
            ...(Number.isInteger(error.code) ? { code: error.code } : {}),
        });
        await mongoose.disconnect().catch(() => {});
        process.exitCode = 1;
    });
