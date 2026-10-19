const express = require('express');
const router = express.Router();
const isLoggedIn = require("../middlewares/isLoggedIn");
const productModel = require('../models/product-model');

router.get('/', (req, res) => {
    let error = req.flash("error")
    res.render("index", {error})
});

router.get("/shop", isLoggedIn, function(req, res){
    res.render("shop")
})

router.get("/logout", isLoggedIn, async function(req, res){
    let product = await productModel.find()
    res.render("shop", {product})
})

module.exports = router;