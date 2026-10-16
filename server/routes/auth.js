const express = require('express');
const router = express.Router();
const {
    isAuthConfigured,
    checkCredentials,
    createToken,
    sessionCookie,
    clearCookie,
    getSession
} = require('../middleware/auth');

// Simple in-memory brute-force protection: limit failed logins per IP.
const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const failures = new Map(); // ip -> { count, firstAt }

function isLockedOut(ip, now = Date.now()) {
    const entry = failures.get(ip);
    if (!entry) return false;
    if (now - entry.firstAt > WINDOW_MS) {
        failures.delete(ip);
        return false;
    }
    return entry.count >= MAX_FAILURES;
}

function recordFailure(ip, now = Date.now()) {
    const entry = failures.get(ip);
    if (!entry || now - entry.firstAt > WINDOW_MS) {
        failures.set(ip, { count: 1, firstAt: now });
    } else {
        entry.count += 1;
    }
}

/**
 * POST /api/auth/login - Sign in to the contractor portal
 */
router.post('/login', (req, res) => {
    if (!isAuthConfigured()) {
        return res.status(503).json({
            error: 'Contractor login is not configured. Set CONTRACTOR_USERNAME and CONTRACTOR_PASSWORD.'
        });
    }

    const ip = req.ip;
    if (isLockedOut(ip)) {
        return res.status(429).json({ error: 'Too many failed attempts. Try again in 15 minutes.' });
    }

    const { username, password } = req.body || {};
    if (!checkCredentials(username, password)) {
        recordFailure(ip);
        return res.status(401).json({ error: 'Invalid username or password' });
    }

    failures.delete(ip);
    res.setHeader('Set-Cookie', sessionCookie(createToken(username)));
    res.json({ username });
});

/**
 * POST /api/auth/logout - End the contractor session
 */
router.post('/logout', (req, res) => {
    res.setHeader('Set-Cookie', clearCookie());
    res.json({ message: 'Logged out' });
});

/**
 * GET /api/auth/me - Current contractor session
 */
router.get('/me', (req, res) => {
    const session = getSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Not signed in' });
    }
    res.json({ username: session.u });
});

// Exposed for tests.
router._resetFailures = () => failures.clear();

module.exports = router;
