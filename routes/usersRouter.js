const express = require('express');
const router = express.Router();
const {registerUser, loginUser, logout} = require("../controllers/authController")
const createAuthRateLimiter = require('../middlewares/authRateLimiter');
const authRateLimiter = createAuthRateLimiter();

router.get('/', (req, res) => {
    res.send('Users route');
});

router.get('/register', (req, res) => res.redirect('/'));

router.post('/register', authRateLimiter, registerUser);

router.post("/login", authRateLimiter, loginUser)

router.post("/logout", logout)
router.get('/logout', logout);

module.exports = router;
