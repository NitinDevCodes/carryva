const express = require('express');
const router = express.Router();
const upload = require('../config/multer-config');
const isOwner = require('../middlewares/isOwner');
const products = require('../controllers/productsController');

function uploadProductImages(req, res, next) {
    return upload.fields([
        { name: 'images', maxCount: 6 },
        // Keep accepting the old single-image form field during migration.
        { name: 'image', maxCount: 6 },
    ])(req, res, (error) => {
        if (!error) return next();
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).send(status === 413
            ? 'Each product image must be 5 MB or smaller.'
            : 'Upload up to 6 JPEG, PNG, or WebP product images.');
    });
}

router.get('/', products.listProducts);
router.get('/:id/edit', isOwner, products.showEditForm);
router.get('/:id', products.showProduct);
router.post('/create', isOwner, uploadProductImages, products.createProduct);
router.post('/:id/update', isOwner, uploadProductImages, products.updateProduct);
router.post('/:id/delete', isOwner, products.deleteProduct);

module.exports = router;
