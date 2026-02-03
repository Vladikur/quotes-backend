const express = require('express');
const jwt = require('jsonwebtoken');

const router = express.Router();

const USERS = {
    student: {
        password: 'presence',
        role: 'student',
    },
    editor: {
        password: 'presence',
        role: 'editor',
    },
};

router.post('/login', (req, res) => {
    const { login, password } = req.body;

    const user = USERS[login];
    if (!user || user.password !== password) {
        return res.status(401).json({ success: false });
    }

    const token = jwt.sign(
        { role: user.role },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
    );

    res.json({
        success: true,
        token,
        role: user.role,
    });
});

module.exports = router;