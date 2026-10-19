const localOrigin = 'http://carryva.local';

module.exports = function safeReturnPath(value, fallback = '/shop') {
    if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') ||
        value.startsWith('//') || value.includes('\\') || /[\u0000-\u001f\u007f]/.test(value)) {
        return fallback;
    }

    try {
        const target = new URL(value, localOrigin);
        if (target.origin !== localOrigin || ['/users/login', '/users/register', '/users/logout'].includes(target.pathname)) {
            return fallback;
        }
        return `${target.pathname}${target.search}${target.hash}`;
    } catch (error) {
        return fallback;
    }
};
