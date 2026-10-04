const express = require('express');
const router = express.Router();
const Owner = require('../models/owner');

router.get('/', (req, res) => {
    res.send('Owners route');
});

if(process.env === 'development') {
    router.post("/create", async function(req, res) {
        let owners = await ownerModel.find()
        if(owners.length > 0) {
            return res
                .status(503)
                .send("you dont have permission to create owners")
        }

        let { fullname, email, password } = req.body;
        let createdOwner = await ownerModel.create({
            fullname,
            email,
            password,
        });
        res.status(201).send(createdOwner);
    });
}

module.exports = router;