const express = require('express');
const router = express.Router();
const upload = require('../config/multer-config');
const isOwner = require('../middlewares/isOwner');
const products = require('../controllers/productsController');

function uploadProductImage(req, res, next) {
    return upload.single('image')(req, res, (error) => {
        if (!error) return next();
        const status = error.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
        return res.status(status).send(status === 413
            ? 'Product images must be 5 MB or smaller.'
            : 'Upload one JPEG, PNG, or WebP image.');
    });
}

router.get('/', products.listProducts);
router.get('/:id/edit', isOwner, products.showEditForm);
router.get('/:id', products.showProduct);
router.post('/create', isOwner, uploadProductImage, products.createProduct);
router.post('/:id/update', isOwner, uploadProductImage, products.updateProduct);
router.post('/:id/delete', isOwner, products.deleteProduct);

module.exports = router;
