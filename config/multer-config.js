const multer = require("multer")

const storage = multer.memoryStorage()
const allowedTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
    storage,
    limits: {
        fileSize: 5 * 1024 * 1024,
        files: 6,
        fields: 32,
    },
    fileFilter: (req, file, callback) => {
        if (!allowedTypes.has(file.mimetype)) {
            return callback(new multer.MulterError('LIMIT_UNEXPECTED_FILE', file.fieldname));
        }
        return callback(null, true);
    },
});

module.exports = upload
