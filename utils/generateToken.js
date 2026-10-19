const jwt = require("jsonwebtoken")
const { JWT_KEY, JWT_ISSUER, JWT_AUDIENCE, TOKEN_TTL_SECONDS } = require('../config/keys');

const generateToken = (user) => {
    return jwt.sign(
        { email: user.email, ver: Number(user.authVersion) || 0 },
        JWT_KEY,
        {
            subject: String(user._id),
            expiresIn: TOKEN_TTL_SECONDS,
            issuer: JWT_ISSUER,
            audience: JWT_AUDIENCE,
            algorithm: 'HS256',
        }
    );
}
module.exports.generateToken = generateToken
