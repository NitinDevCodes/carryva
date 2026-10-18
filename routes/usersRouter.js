const express = require('express');
const router = express.Router();
const {registerUser, loginUser} = require("../controllers/authController")

router.get('/', (req, res) => {
    res.send('Users route');
});

router.get('/register', registerUser);

router.post("/login", loginUser)

module.exports = router;