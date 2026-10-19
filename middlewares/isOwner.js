const isLoggedIn = require('./isLoggedIn');

module.exports = function isOwner(req, res, next) {
    return isLoggedIn(req, res, () => {
        if (req.user.role !== 'owner') {
            return res.status(403).send('Owner access is required for this action.');
        }
        return next();
    });
};
