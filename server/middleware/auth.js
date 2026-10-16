/**
 * Contractor authentication.
 *
 * A dependency-free session scheme: on login the server issues an HMAC-signed
 * token in an HttpOnly cookie. The token carries the username and an expiry,
 * so no server-side session store is needed.
 *
 * Configure with environment variables:
 *   CONTRACTOR_USERNAME  login name for the contractor portal
 *   CONTRACTOR_PASSWORD  password for the contractor portal (required to enable login)
 *   SESSION_SECRET       secret used to sign session tokens (random per boot if unset)
 *   SESSION_TTL_HOURS    session lifetime, default 8
 */
const crypto = require('crypto');

const COOKIE_NAME = 'hvac_session';

let generatedSecret = null;

function getSecret() {
    if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
    if (!generatedSecret) {
        generatedSecret = crypto.randomBytes(32).toString('hex');
        console.warn('[Auth] SESSION_SECRET not set. Using a random secret; sessions reset on restart.');
    }
    return generatedSecret;
}

function getTtlMs() {
    const hours = Number(process.env.SESSION_TTL_HOURS) || 8;
    return hours * 60 * 60 * 1000;
}

function sign(data) {
    return crypto.createHmac('sha256', getSecret()).update(data).digest('base64url');
}

/** Constant-time string comparison that does not leak length via early exit. */
function safeEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

function createToken(username, now = Date.now()) {
    const payload = Buffer.from(JSON.stringify({ u: username, exp: now + getTtlMs() })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

/** Returns the session payload, or null if the token is missing, tampered with or expired. */
function verifyToken(token, now = Date.now()) {
    if (typeof token !== 'string' || !token.includes('.')) return null;
    const [payload, signature] = token.split('.');
    if (!payload || !signature || !safeEqual(signature, sign(payload))) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (typeof data.exp !== 'number' || data.exp < now) return null;
        return data;
    } catch {
        return null;
    }
}

function parseCookies(header) {
    const cookies = {};
    if (!header) return cookies;
    for (const part of header.split(';')) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const value = part.slice(idx + 1).trim();
        try {
            cookies[key] = decodeURIComponent(value);
        } catch {
            cookies[key] = value;
        }
    }
    return cookies;
}

function getSession(req) {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    return verifyToken(token);
}

function isAuthConfigured() {
    return Boolean(process.env.CONTRACTOR_USERNAME && process.env.CONTRACTOR_PASSWORD);
}

function checkCredentials(username, password) {
    if (!isAuthConfigured()) return false;
    // Evaluate both comparisons so timing does not reveal which one failed.
    const userOk = safeEqual(username || '', process.env.CONTRACTOR_USERNAME);
    const passOk = safeEqual(password || '', process.env.CONTRACTOR_PASSWORD);
    return userOk && passOk;
}

function sessionCookie(token) {
    const parts = [
        `${COOKIE_NAME}=${token}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Strict',
        `Max-Age=${Math.floor(getTtlMs() / 1000)}`
    ];
    if (process.env.NODE_ENV === 'production') parts.push('Secure');
    return parts.join('; ');
}

function clearCookie() {
    return `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

/** API guard: 401 JSON when there is no valid contractor session. */
function requireContractor(req, res, next) {
    const session = getSession(req);
    if (!session) {
        return res.status(401).json({ error: 'Authentication required' });
    }
    req.contractor = session;
    next();
}

/** Page guard: redirects to the login page when there is no valid session. */
function requireContractorPage(req, res, next) {
    if (getSession(req)) return next();
    res.redirect('/login');
}

module.exports = {
    COOKIE_NAME,
    createToken,
    verifyToken,
    parseCookies,
    getSession,
    isAuthConfigured,
    checkCredentials,
    sessionCookie,
    clearCookie,
    requireContractor,
    requireContractorPage
};
