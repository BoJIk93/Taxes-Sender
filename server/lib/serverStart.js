/** Время старта процесса сервера (мс), задаётся при listen. */
let startedAt = null;

function setServerStartedAt() {
    startedAt = Date.now();
}

function getServerStartedAt() {
    return startedAt;
}

module.exports = { setServerStartedAt, getServerStartedAt };
