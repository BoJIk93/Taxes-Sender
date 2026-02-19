const fs = require('fs');
const path = require('path');
const { encrypt, decrypt } = require('./encryption');

const DATA_DIR = path.join(__dirname, '..', '..', 'data');
const CONFIG_FILE = path.join(DATA_DIR, 'config.enc');

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            return null;
        }
        const encrypted = fs.readFileSync(CONFIG_FILE, 'utf8');
        const decrypted = decrypt(encrypted);
        return decrypted ? JSON.parse(decrypted) : null;
    } catch (e) {
        console.error('Ошибка загрузки конфигурации:', e);
        return null;
    }
}

function saveConfig(config) {
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        const encrypted = encrypt(JSON.stringify(config));
        fs.writeFileSync(CONFIG_FILE, encrypted, 'utf8');
        return true;
    } catch (e) {
        console.error('Ошибка сохранения конфигурации:', e);
        return false;
    }
}

module.exports = { loadConfig, saveConfig };
