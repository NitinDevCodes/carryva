const express = require('express');
const router = express.Router();
const {registerUser, loginUser, logout} = require("../controllers/authController")

router.get('/', (req, res) => {
    res.send('Users route');
});

router.get('/register', (req, res) => res.redirect('/'));

router.post('/register', registerUser);

router.post("/login", loginUser)

router.post("/logout", logout)
router.get('/logout', logout);

module.exports = router;
