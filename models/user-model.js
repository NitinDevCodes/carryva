const mongoose = require('mongoose');

const userSchema = mongoose.Schema({
    fullName:{
        type: String,
        minlength: 3,
        trim: true,
    },
    email: String,
    password: String,
    cart:{
        type: Array,
        default: []
    },
    orders: {
        type: Array,
        default: []
    },
    contact: Number,
    picture: String
})

module.exports = mongoose.model('User', userSchema)