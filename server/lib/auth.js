const crypto = require('crypto');
const { loadConfig, saveConfig } = require('./config');

// Сессии: token → { login, createdAt }
const sessions = new Map();

const DEFAULT_LOGIN = 'admin';
const DEFAULT_PASSWORD = 'admin';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 часа

// ============== ХЕШИРОВАНИЕ ==============

function hashPassword(password, salt) {
    if (!salt) salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.createHash('sha256').update(salt + password).digest('hex');
    return salt + ':' + hash;
}

function verifyPassword(password, storedHash) {
    if (!storedHash || !password) return false;
    const [salt] = storedHash.split(':');
    if (!salt) return false;
    return hashPassword(password, salt) === storedHash;
}

// ============== КОНФИГ АВТОРИЗАЦИИ ==============

function getAuthConfig() {
    const config = loadConfig() || {};
    return {
        enabled: config.auth_enabled === true,
        login: config.auth_login || DEFAULT_LOGIN,
        passwordHash: config.auth_password_hash || null
    };
}

function saveAuthConfig(authData) {
    const config = loadConfig() || {};
    if (authData.enabled !== undefined) config.auth_enabled = authData.enabled;
    if (authData.login !== undefined) config.auth_login = authData.login;
    if (authData.passwordHash !== undefined) config.auth_password_hash = authData.passwordHash;
    return saveConfig(config);
}

function isAuthEnabled() {
    return getAuthConfig().enabled;
}

// ============== СЕССИИ ==============

function createSession(login) {
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { login, createdAt: Date.now() });
    return token;
}

function validateSession(token) {
    if (!token) return false;
    const session = sessions.get(token);
    if (!session) return false;
    if (Date.now() - session.createdAt > SESSION_TTL_MS) {
        sessions.delete(token);
        return false;
    }
    return true;
}

function destroySession(token) {
    if (token) sessions.delete(token);
}

// Очистка просроченных сессий (каждые 30 минут)
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (now - session.createdAt > SESSION_TTL_MS) {
            sessions.delete(token);
        }
    }
}, 30 * 60 * 1000);

// ============== ЗАЩИТА ОТ БРУТФОРСА ==============

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60 * 1000; // 5 минут
const loginAttempts = new Map(); // ip → { count, firstAttempt, lockedUntil }

function getAttemptInfo(ip) {
    const key = ip || 'unknown';
    if (!loginAttempts.has(key)) {
        loginAttempts.set(key, { count: 0, firstAttempt: 0, lockedUntil: 0 });
    }
    return loginAttempts.get(key);
}

function registerFailedAttempt(ip) {
    const info = getAttemptInfo(ip);
    const now = Date.now();
    if (info.count === 0) info.firstAttempt = now;
    info.count++;
    if (info.count >= MAX_ATTEMPTS) {
        info.lockedUntil = now + LOCKOUT_MS;
    }
}

function resetAttempts(ip) {
    loginAttempts.delete(ip || 'unknown');
}

function isLockedOut(ip) {
    const info = getAttemptInfo(ip);
    const now = Date.now();
    if (info.lockedUntil && now < info.lockedUntil) {
        return true;
    }
    // Блокировка истекла — сбрасываем
    if (info.lockedUntil && now >= info.lockedUntil) {
        resetAttempts(ip);
    }
    return false;
}

function getRemainingLockSeconds(ip) {
    const info = getAttemptInfo(ip);
    if (!info.lockedUntil) return 0;
    const remaining = Math.ceil((info.lockedUntil - Date.now()) / 1000);
    return remaining > 0 ? remaining : 0;
}

function getRemainingAttempts(ip) {
    const info = getAttemptInfo(ip);
    return Math.max(0, MAX_ATTEMPTS - info.count);
}

// Очистка старых записей каждые 10 минут
setInterval(() => {
    const now = Date.now();
    for (const [key, info] of loginAttempts) {
        if (info.lockedUntil && now >= info.lockedUntil) {
            loginAttempts.delete(key);
        } else if (now - info.firstAttempt > LOCKOUT_MS * 2) {
            loginAttempts.delete(key);
        }
    }
}, 10 * 60 * 1000);

// ============== ЛОГИН / ПРОВЕРКА ==============

function attemptLogin(login, password, ip) {
    const auth = getAuthConfig();
    if (!auth.enabled) return { success: false, error: 'Авторизация отключена' };

    // Проверка блокировки
    if (isLockedOut(ip)) {
        const sec = getRemainingLockSeconds(ip);
        const min = Math.ceil(sec / 60);
        return { success: false, error: `Слишком много попыток. Повторите через ${min} мин.`, locked: true, retryAfter: sec };
    }

    if (login !== auth.login) {
        registerFailedAttempt(ip);
        const remaining = getRemainingAttempts(ip);
        const locked = isLockedOut(ip);
        return { success: false, error: 'Неверный логин или пароль' + (remaining > 0 ? ` (осталось попыток: ${remaining})` : ''), locked, retryAfter: locked ? getRemainingLockSeconds(ip) : 0 };
    }

    // Если пароль ещё не задан (первый запуск) — проверяем дефолтный
    if (!auth.passwordHash) {
        if (password === DEFAULT_PASSWORD) {
            resetAttempts(ip);
            const token = createSession(login);
            return { success: true, token };
        }
        registerFailedAttempt(ip);
        const remaining = getRemainingAttempts(ip);
        const locked = isLockedOut(ip);
        return { success: false, error: 'Неверный логин или пароль' + (remaining > 0 ? ` (осталось попыток: ${remaining})` : ''), locked, retryAfter: locked ? getRemainingLockSeconds(ip) : 0 };
    }

    if (verifyPassword(password, auth.passwordHash)) {
        resetAttempts(ip);
        const token = createSession(login);
        return { success: true, token };
    }
    registerFailedAttempt(ip);
    const remaining = getRemainingAttempts(ip);
    const locked = isLockedOut(ip);
    return { success: false, error: 'Неверный логин или пароль' + (remaining > 0 ? ` (осталось попыток: ${remaining})` : ''), locked, retryAfter: locked ? getRemainingLockSeconds(ip) : 0 };
}

function changePassword(currentPassword, newLogin, newPassword) {
    const auth = getAuthConfig();

    // Проверяем текущий пароль
    if (auth.passwordHash) {
        if (!verifyPassword(currentPassword, auth.passwordHash)) {
            return { success: false, error: 'Неверный текущий пароль' };
        }
    } else {
        if (currentPassword !== DEFAULT_PASSWORD) {
            return { success: false, error: 'Неверный текущий пароль' };
        }
    }

    const updates = {};
    if (newLogin && newLogin.trim()) updates.login = newLogin.trim();
    if (newPassword && newPassword.trim()) updates.passwordHash = hashPassword(newPassword.trim());

    if (Object.keys(updates).length === 0) {
        return { success: false, error: 'Нет данных для обновления' };
    }

    const ok = saveAuthConfig(updates);
    return ok ? { success: true } : { success: false, error: 'Ошибка сохранения' };
}

function resetAuthToDefaults() {
    const ok = saveAuthConfig({
        login: DEFAULT_LOGIN,
        passwordHash: null
    });
    // Очищаем все сессии
    sessions.clear();
    return ok ? { success: true, defaultLogin: DEFAULT_LOGIN, defaultPassword: DEFAULT_PASSWORD } : { success: false, error: 'Ошибка сброса' };
}

function toggleAuth(enable) {
    const auth = getAuthConfig();
    // При первом включении — если пароль не задан, хешируем дефолтный
    if (enable && !auth.passwordHash) {
        saveAuthConfig({ enabled: true, passwordHash: hashPassword(DEFAULT_PASSWORD) });
    } else {
        saveAuthConfig({ enabled: enable });
    }
    if (!enable) sessions.clear();
    return { success: true, enabled: enable };
}

// ============== COOKIE HELPERS ==============

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    cookieHeader.split(';').forEach(part => {
        const [key, ...rest] = part.trim().split('=');
        if (key) cookies[key.trim()] = rest.join('=').trim();
    });
    return cookies;
}

function getTokenFromRequest(req) {
    const cookies = parseCookies(req.headers.cookie);
    return cookies.auth_token || null;
}

function setTokenCookie(res, token) {
    const maxAge = SESSION_TTL_MS / 1000;
    res.setHeader('Set-Cookie', `auth_token=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}`);
}

function clearTokenCookie(res) {
    res.setHeader('Set-Cookie', 'auth_token=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
}

function clearAllSessions() {
    sessions.clear();
}

module.exports = {
    isAuthEnabled,
    getAuthConfig,
    attemptLogin,
    createSession,
    changePassword,
    resetAuthToDefaults,
    toggleAuth,
    validateSession,
    destroySession,
    clearAllSessions,
    getTokenFromRequest,
    setTokenCookie,
    clearTokenCookie,
    DEFAULT_LOGIN,
    DEFAULT_PASSWORD
};
