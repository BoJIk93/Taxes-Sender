/**
 * Taxes Sender - Локальный сервер для отправки чеков в налоговую
 * Главный файл - запуск сервера
 */

const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const { initDatabase } = require('./lib/database');
const { migrateFromJSON } = require('./lib/migration');
const { ensureServiceNamesEmptyOnce } = require('./lib/storage');
const { handleRequest } = require('./lib/routes');
const { setServerStartedAt } = require('./lib/serverStart');

const PORT = 3847;

// Инициализация и запуск
async function start() {
    try {
        // Инициализируем базу данных
        console.log('Инициализация базы данных SQLite...');
        await initDatabase();
        
        // Мигрируем данные из JSON если есть
        migrateFromJSON();
        // Один раз очищаем старые дефолтные услуги из БД (после этого флаг ставится, больше не чистим)
        ensureServiceNamesEmptyOnce();
        
        // Запускаем сервер
const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
    setServerStartedAt();
    const projectDir = path.resolve(__dirname, '..');
    const installScript = path.join(projectDir, 'install', 'linux', 'install.sh');
    const logFile = path.join(projectDir, 'data', 'server.log');
    console.log(`
╔════════════════════════════════════════════════════════════╗
║   🧾 Taxes Sender - Отправка чеков в налоговую             ║
║   Локально:  http://127.0.0.1:${PORT}   В сети: http://<IP>:${PORT}  ║
╚════════════════════════════════════════════════════════════╝
`);
    if (process.platform === 'linux') {
        console.log('  Команды:');
        console.log('  • Установить (автозапуск при старте системы):');
        console.log('    sudo bash "' + installScript + '"');
        console.log('  • Удалить автозагрузку (сервис останется, просто не будет запускаться сам):');
        console.log('    sudo bash "' + installScript + '" uninstall');
        console.log('  • Смотреть логи:');
        console.log('    tail -f "' + logFile + '"');
        console.log('  • Остановить этот процесс: Ctrl+C  или  pkill -f "server/index.js"');
        console.log('');
    } else {
        console.log('  Остановить: Ctrl+C\n');
    }
    
    // Открываем браузер только на Windows
    if (process.platform === 'win32') {
        const opener = spawn('cmd', ['/c', 'start', '', `http://127.0.0.1:${PORT}`], {
            detached: true,
            stdio: 'ignore',
            windowsHide: false
        });
        opener.unref();
    }
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`Порт ${PORT} уже занят. Закройте другие копии программы.`);
    } else {
        console.error('Ошибка сервера:', e);
    }
    process.exit(1);
});
    } catch (e) {
        console.error('Ошибка инициализации:', e);
        process.exit(1);
    }
}

start();
