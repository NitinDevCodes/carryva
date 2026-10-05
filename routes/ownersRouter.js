const express = require('express');
const router = express.Router();
const Owner = require('../models/owner-model');

router.get('/', (req, res) => {
    res.send('Owners route');
});

if(process.env.NODE_ENV === 'development') {
    router.post("/create", async function(req, res) {
        let owners = await Owner.find()
        if(owners.length > 0) {
            return res
                .status(503)
                .send("you dont have permission to create owners")
        }

        let { fullName, email, password } = req.body;
        let createdOwner = await Owner.create({
            fullName,
            email,
            password,
        });
        res.status(201).send(createdOwner);
    });
}

module.exports = router;