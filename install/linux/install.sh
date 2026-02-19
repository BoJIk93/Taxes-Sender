#!/usr/bin/env bash
# Taxes Sender — установка / удаление (Linux)
# Использование:
#   sudo ./install/linux/install.sh          # установить
#   sudo ./install/linux/install.sh uninstall # удалить автозагрузку

set -euo pipefail

RED='\033[0;31m'
YELLOW='\033[1;33m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()   { echo -e "  ${GREEN}[OK]${NC} $*"; }
warn() { echo -e "  ${YELLOW}[!]${NC} $*"; }
err()  { echo -e "  ${RED}[ОШИБКА]${NC} $*"; exit 1; }
info() { echo -e "  ${CYAN}[-]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
SERVICE_NAME="taxes-sender"
SERVICE_FILE="/etc/systemd/system/${SERVICE_NAME}.service"
CURRENT_USER="${SUDO_USER:-$USER}"
PORT=3847

# Получить внешний (публичный) IP для доступа из интернета
get_public_ip() {
    local ip
    for url in "https://api.ipify.org" "https://ifconfig.me/ip" "https://icanhazip.com"; do
        ip=$(curl -s -m 3 "$url" 2>/dev/null | tr -d '\r\n')
        if [[ -n "$ip" && "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
            echo "$ip"
            return 0
        fi
    done
    echo ""
}

# Получить локальный IP в сети (первый не loopback)
get_local_ip() {
    (hostname -I 2>/dev/null | awk '{print $1}') || (ip -4 route get 1 2>/dev/null | grep -oP 'src \K[0-9.]+')
}

# Вывести все доступные адреса (локально + извне)
print_access_urls() {
    local pub_ip local_ip
    echo ""
    echo -e "  ${CYAN}Доступ к приложению:${NC}"
    echo "  • Локально:      http://127.0.0.1:$PORT"
    local_ip=$(get_local_ip)
    if [[ -n "$local_ip" ]]; then
        echo "  • В локальной сети: http://$local_ip:$PORT"
    fi
    pub_ip=$(get_public_ip)
    if [[ -n "$pub_ip" ]]; then
        echo -e "  • ${GREEN}Из интернета:  http://$pub_ip:$PORT${NC}"
    else
        echo -e "  • ${YELLOW}Внешний IP не определён (нет выхода в интернет или сервисы недоступны)${NC}"
    fi
    echo ""
}

# ============================================================
# Uninstall: снять автозагрузку (systemd + crontab)
# ============================================================
do_uninstall() {
    echo ""
    echo -e "${BOLD}Taxes Sender — удаление автозагрузки${NC}"
    echo ""
    REMOVED=0

    if [ -f "$SERVICE_FILE" ]; then
        systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null && sudo systemctl stop "$SERVICE_NAME" && ok "Сервис остановлен."
        systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null && sudo systemctl disable "$SERVICE_NAME" && ok "Автозапуск отключён."
        sudo rm -f "$SERVICE_FILE"
        sudo systemctl daemon-reload
        ok "Сервис systemd удалён."
        REMOVED=1
    else
        warn "Сервис systemd не найден."
    fi

    if crontab -l 2>/dev/null | grep -q "taxes-sender\|TaxesSender"; then
        TEMP_CRON=$(mktemp)
        crontab -l 2>/dev/null | grep -v "taxes-sender\|TaxesSender" > "$TEMP_CRON" || true
        crontab "$TEMP_CRON"
        rm -f "$TEMP_CRON"
        ok "Запись из crontab удалена."
        REMOVED=1
    fi

    if [ "$REMOVED" -eq 0 ]; then
        info "Автозагрузка не была настроена."
    else
        ok "Автозагрузка снята."
        info "Код и данные (data) сохранены. Папка node_modules нужна для запуска приложения."
    fi
    echo ""
    if [ -d "$PROJECT_DIR/node_modules" ]; then
        read -r -p "  Удалить node_modules (освободить место; для запуска потом снова: npm install)? [y/N]: " REMOVE_NM
        if [[ "${REMOVE_NM:-}" =~ ^[Yy]$ ]]; then
            sudo rm -rf "$PROJECT_DIR/node_modules"
            ok "node_modules удалён. Чтобы снова запустить приложение: cd \"$PROJECT_DIR\" && npm install && node server/index.js"
        fi
    fi
    echo ""
    exit 0
}

# ============================================================
# Install
# ============================================================
do_install() {
    echo ""
    echo -e "${BOLD}Taxes Sender — установка${NC}"
    echo "  Папка: $PROJECT_DIR"
    echo ""

    # Уже установлен? (сервис есть и включён)
    if [ -f "$SERVICE_FILE" ] && systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
        ok "Сервис уже установлен и включён."
        echo ""
        echo "  Что сделать?"
        echo "    [1] Обновить зависимости и перезапустить"
        echo "    [2] Удалить сервис (отключить автозапуск)"
        echo "    [3] Ничего не делать"
        echo ""
        read -r -p "  Ваш выбор [1/2/3]: " CHOICE
        case "${CHOICE:-3}" in
            1)
                cd "$PROJECT_DIR" && npm install --loglevel=error && ok "Зависимости обновлены."
                sudo systemctl restart "$SERVICE_NAME" 2>/dev/null && ok "Сервис перезапущен."
                print_access_urls
                ;;
            2)
                do_uninstall
                ;;
            *)
                print_access_urls
                ;;
        esac
        exit 0
    fi

    # Node.js
    if ! command -v node &>/dev/null; then
        err "Node.js не найден. Установите: https://nodejs.org (нужна версия 16+)"
    fi
    NODE_MAJOR=$(node --version | sed 's/v\([0-9]*\).*/\1/')
    [ "$NODE_MAJOR" -lt 16 ] && err "Нужен Node.js 16+. Сейчас: v$NODE_MAJOR"
    ok "Node.js $(node --version)"

    # Зависимости
    cd "$PROJECT_DIR"
    npm install --loglevel=error
    ok "Зависимости установлены."

    # Автозагрузка
    read -r -p "  Запускать при старте системы? [Y/N]: " WANT_AUTOSTART

    if [[ "${WANT_AUTOSTART:-}" =~ ^[Yy]$ ]]; then
        if command -v systemctl &>/dev/null; then
            NODE_PATH=$(command -v node)
            sudo tee "$SERVICE_FILE" >/dev/null <<EOF
[Unit]
Description=Taxes Sender - отправка чеков в налоговую
After=network.target

[Service]
Type=simple
User=$CURRENT_USER
WorkingDirectory=$PROJECT_DIR
ExecStart=$NODE_PATH server/index.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
EOF
            sudo systemctl daemon-reload
            sudo systemctl enable "$SERVICE_NAME"
            ok "Сервис systemd включён (пользователь: $CURRENT_USER)."
        else
            CRON_CMD="@reboot cd $PROJECT_DIR && node server/index.js >> $PROJECT_DIR/data/server.log 2>&1"
            if crontab -l 2>/dev/null | grep -q "taxes-sender\|TaxesSender"; then
                warn "Запись в crontab уже есть (crontab -e)."
            else
                (crontab -l 2>/dev/null; echo "# Taxes Sender"; echo "$CRON_CMD") | crontab -
                ok "Добавлено в crontab (@reboot)."
            fi
        fi
    fi

    # Порт в файрволе (опционально)
    if command -v ufw &>/dev/null; then
        read -r -p "  Открыть порт $PORT в UFW? [Y/N]: " OPEN_FW
        [[ "${OPEN_FW:-}" =~ ^[Yy]$ ]] && sudo ufw allow ${PORT}/tcp && ok "Порт $PORT открыт."
    elif command -v firewall-cmd &>/dev/null; then
        read -r -p "  Открыть порт $PORT в firewalld? [Y/N]: " OPEN_FW
        [[ "${OPEN_FW:-}" =~ ^[Yy]$ ]] && sudo firewall-cmd --permanent --add-port=${PORT}/tcp && sudo firewall-cmd --reload && ok "Порт $PORT открыт."
    fi

    echo ""
    echo -e "  ${GREEN}Готово.${NC}"
    print_access_urls
    echo "  Удаление автозагрузки: sudo $0 uninstall"
    echo "  Все команды: cat $SCRIPT_DIR/COMMANDS.txt"
    echo ""

    read -r -p "  Запустить сейчас? [Y/N]: " START_NOW
    if [[ "${START_NOW:-}" =~ ^[Yy]$ ]]; then
        if [ -f "$SERVICE_FILE" ] && systemctl is-enabled --quiet "$SERVICE_NAME" 2>/dev/null; then
            sudo systemctl start "$SERVICE_NAME" && ok "Сервис запущен."
        else
            (cd "$PROJECT_DIR" && nohup node server/index.js >> data/server.log 2>&1 &)
            sleep 1
            ok "Сервер запущен в фоне. Логи: tail -f $PROJECT_DIR/data/server.log"
        fi
        print_access_urls
    fi
    echo ""
}

# ============================================================
# Main
# ============================================================
case "${1:-install}" in
    uninstall|remove|--uninstall|--remove) do_uninstall ;;
    install|"") do_install ;;
    *) echo "Использование: $0 [install|uninstall]"; exit 1 ;;
esac
