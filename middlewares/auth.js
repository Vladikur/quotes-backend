const jwt = require('jsonwebtoken');

exports.auth = (req, res, next) => {
    const header = req.headers.authorization;
    if (!header) return res.sendStatus(401);

    const token = header.replace('Bearer ', '');

    try {
        req.user = jwt.verify(token, process.env.JWT_SECRET);
        next();
    } catch {
        res.sendStatus(401);
    }
};

exports.requireRole = (role) => (req, res, next) => {
    if (req.user.role !== role) {
        return res.sendStatus(403);
    }
    next();
};