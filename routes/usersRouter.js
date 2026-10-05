const express = require('express');
const router = express.Router();
const userModel = require('../models/user-model');

router.get('/', (req, res) => {
    res.send('Users route');
});

router.get('/register', async (req, res) => {
    let { fullName, email, password } = req.body;

    let user = await userModel.create({
        fullName,
        email,
        password
    });
    res.status(201).send(user);
});

module.exports = router;