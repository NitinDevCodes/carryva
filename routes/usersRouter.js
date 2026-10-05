const express = require('express');
const router = express.Router();
const userModel = require('../models/user-model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

router.get('/', (req, res) => {
    res.send('Users route');
});

router.get('/register', (req, res) => {
    try {
        let { fullName, email, password } = req.query;

        bcrypt.genSalt(10, async (err, salt) => {
            bcrypt.hash(password, salt, async (err, hash) => {
                if (err) return res.send(err.message);
                else {
                    let user = await userModel.create({
                        fullName,
                        email,
                        password: hash
                    });
                    let token = jwt.sign({email, id: user._id}, 'secret')
                    res.cookie("token", token)
                    res.send("user created successfully");
                }
            });
        });
    } catch (error) {
        res.send(error.message);
    }
});

module.exports = router;