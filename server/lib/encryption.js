const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const ENCRYPTION_KEY_FILE = path.join(DATA_DIR, '.key');

function getOrCreateEncryptionKey() {
    try {
        if (fs.existsSync(ENCRYPTION_KEY_FILE)) {
            return fs.readFileSync(ENCRYPTION_KEY_FILE, 'utf8');
        }
        const key = crypto.randomBytes(32).toString('hex');
        fs.writeFileSync(ENCRYPTION_KEY_FILE, key, 'utf8');
        return key;
    } catch (e) {
        console.error('Ошибка работы с ключом шифрования:', e);
        return crypto.randomBytes(32).toString('hex');
    }
}

function encrypt(text) {
    const key = Buffer.from(getOrCreateEncryptionKey(), 'hex');
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
    try {
        const key = Buffer.from(getOrCreateEncryptionKey(), 'hex');
        const parts = text.split(':');
        const iv = Buffer.from(parts[0], 'hex');
        const encryptedText = parts[1];
        const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (e) {
        console.error('Ошибка расшифровки:', e);
        return null;
    }
}

module.exports = { encrypt, decrypt };
