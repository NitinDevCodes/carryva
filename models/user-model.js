const mongoose = require('mongoose');

const userSchema = mongoose.Schema({
    fullName:{
        type: String,
        required: true,
        minlength: 3,
        maxlength: 80,
        trim: true,
    },
    email: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        maxlength: 254,
        unique: true,
        match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    },
    password: {
        type: String,
        required: true,
        select: false,
    },
    role: {
        type: String,
        enum: ['customer', 'owner'],
        default: 'customer',
        required: true,
        index: true,
    },
    authVersion: {
        type: Number,
        default: 0,
        min: 0,
        select: false,
    },
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
