const userModel = require('../models/user-model');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const {generateToken} = require("../utils/generateToken")


module.exports.registerUser = async(req, res) => {
    try {
        let { fullName, email, password } = req.query;

        let user = userModel.findOne({email: email})
        if(user) return res.user(401).send("Account already exist")

        bcrypt.genSalt(10, async (err, salt) => {
            bcrypt.hash(password, salt, async (err, hash) => {
                if (err) return res.send(err.message);
                else {
                    let user = await userModel.create({
                        fullName,
                        email,
                        password: hash
                    });
                    let token = generateToken(user)
                    res.cookie("token", token)
                    res.send("user created successfully");
                }
            });
        });
    } catch (error) {
        res.send(error.message);
    }
}

module.exports.loginUser = async function(req, res) {
    let {email, password} = req.body

    let user = await userModel.findOne({email:email})
    if(!user) return res.sennd("Email or password is wrong")

        bcrypt.compare(password, user.password, function(err, result){
            res.send(result)
        })
}