const mongoose = require('mongoose');

mongoose.connect('mongodb://127.0.0.1:27017/Carryva')

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
    isAdmin: Boolean,
    orders: {
        type: Array,
        default: []
    },
    contact: Number,
    picture: String
})

module.exports = mongoose.model('User', userSchema)