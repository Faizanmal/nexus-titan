#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# NEXUS TITAN - Automated Live VM Deployment Script (Ubuntu / Debian)
# ==============================================================================

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[1;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
RESET="\033[0m"

echo -e "${BOLD}${CYAN}"
echo "=========================================================="
echo "          NEXUS TITAN - VM DEPLOYMENT MANAGER             "
echo "=========================================================="
echo -e "${RESET}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_ROOT"

# 1. Check Root / Sudo privileges
if [ "$EUID" -ne 0 ] && ! command -v sudo >/dev/null 2>&1; then
    echo -e "${RED}[ERROR] This script requires sudo or root privileges to configure Docker and ports.${RESET}"
    exit 1
fi
SUDO=""
if [ "$EUID" -ne 0 ]; then
    SUDO="sudo"
fi

# 2. Check and Install Docker & Docker Compose
echo -e "${BOLD}[1/6] Verifying Docker environment...${RESET}"
if ! command -v docker >/dev/null 2>&1; then
    echo -e "${YELLOW}Docker is not installed. Installing Docker via official setup script...${RESET}"
    $SUDO apt-get update -y
    $SUDO apt-get install -y ca-certificates curl gnupg lsb-release
    curl -fsSL https://get.docker.com -o get-docker.sh
    $SUDO sh get-docker.sh
    rm -f get-docker.sh
    # Add current user to docker group if non-root
    if [ -n "${SUDO_USER:-}" ]; then
        $SUDO usermod -aG docker "$SUDO_USER" || true
    fi
    echo -e "${GREEN}✓ Docker installed successfully.${RESET}"
else
    echo -e "${GREEN}✓ Docker is already installed: $(docker --version)${RESET}"
fi

# Ensure docker compose plugin exists
if ! docker compose version >/dev/null 2>&1; then
    echo -e "${YELLOW}Installing Docker Compose plugin...${RESET}"
    $SUDO apt-get update -y
    $SUDO apt-get install -y docker-compose-plugin
fi
echo -e "${GREEN}✓ Docker Compose plugin available: $(docker compose version)${RESET}"

# 3. Configure Firewall (UFW)
echo -e "\n${BOLD}[2/6] Configuring firewall rules (UFW)...${RESET}"
if command -v ufw >/dev/null 2>&1; then
    # ALWAYS ensure SSH is allowed first to avoid locking out the admin
    $SUDO ufw allow 22/tcp comment 'SSH' >/dev/null 2>&1 || true
    $SUDO ufw allow 80/tcp comment 'HTTP (Let Encrypt / Caddy)' >/dev/null 2>&1 || true
    $SUDO ufw allow 443/tcp comment 'HTTPS (Caddy)' >/dev/null 2>&1 || true
    $SUDO ufw allow 443/udp comment 'HTTP/3 QUIC (Caddy)' >/dev/null 2>&1 || true
    
    UFW_STATUS=$($SUDO ufw status | head -n 1 || echo "inactive")
    if [[ "$UFW_STATUS" =~ "Status: active" ]]; then
        echo -e "${GREEN}✓ UFW rules updated (Ports 22, 80, 443 open).${RESET}"
    else
        echo -e "${YELLOW}UFW is currently inactive. You can enable it with: sudo ufw enable${RESET}"
    fi
else
    echo -e "${YELLOW}UFW not found; ensure your cloud security group / firewall permits ports 80 and 443.${RESET}"
fi

# 4. Check .env.production file (seeded from the single root .env.example)
echo -e "\n${BOLD}[3/6] Checking production environment file...${RESET}"
if [ ! -f ".env.production" ]; then
    if [ ! -f ".env.example" ]; then
        echo -e "${RED}[ERROR] .env.example is missing; cannot seed .env.production.${RESET}"
        exit 1
    fi
    echo -e "${YELLOW}No .env.production found! Creating from .env.example...${RESET}"
    cp .env.example .env.production

    # Switch to production defaults and generate a strong Postgres password
    RAND_PASS=$(openssl rand -hex 20 2>/dev/null || date +%s | sha256sum | head -c 32)
    sed -i "s/^APP_ENV=.*/APP_ENV=production/" .env.production
    sed -i "s/^POSTGRES_USER=.*/POSTGRES_USER=nexus_admin/" .env.production
    sed -i "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=${RAND_PASS}/" .env.production
    sed -i "s/^POSTGRES_DB=.*/POSTGRES_DB=nexus_titan/" .env.production
    sed -i "s|^NEXT_PUBLIC_API_URL=.*|NEXT_PUBLIC_API_URL=https://api.yourdomain.com|" .env.production
    sed -i "s/^NEXT_PUBLIC_INFERENCE_PROVIDER=.*/NEXT_PUBLIC_INFERENCE_PROVIDER=fixture/" .env.production
    sed -i "s/replace-with-a-secure-random-password/${RAND_PASS}/g" .env.production

    echo -e "${RED}[ACTION REQUIRED] A new .env.production has been created.${RESET}"
    echo -e "Please edit ${BOLD}.env.production${RESET} with your real domain name and email:"
    echo -e "  nano .env.production"
    echo -e "Set:"
    echo -e "  DOMAIN_WEB=app.yourdomain.com"
    echo -e "  DOMAIN_API=api.yourdomain.com"
    echo -e "  ACME_EMAIL=your-email@yourdomain.com"
    echo -e "  NEXT_PUBLIC_API_URL=https://api.yourdomain.com"
    echo -e "\nThen run ${BOLD}./scripts/deploy-vm.sh${RESET} again."
    exit 0
fi

# Source .env.production for checks
set -a
# shellcheck disable=SC1091
source .env.production
set +a

if [[ "${DOMAIN_WEB}" =~ "yourdomain.com" ]] || [[ "${DOMAIN_API}" =~ "yourdomain.com" ]]; then
    echo -e "${RED}[WARNING] DOMAIN_WEB or DOMAIN_API is still set to placeholder 'yourdomain.com'!${RESET}"
    echo -e "Please update .env.production with your real domain before proceeding."
    read -rp "Do you want to proceed anyway for local/testing? (y/N): " CONFIRM
    if [[ "$CONFIRM" != "y" && "$CONFIRM" != "Y" ]]; then
        echo "Aborted. Update .env.production and run again."
        exit 1
    fi
fi
echo -e "${GREEN}✓ Environment configuration loaded.${RESET}"

# 5. Build and Deploy Containers
echo -e "\n${BOLD}[4/6] Building and launching containers...${RESET}"
docker compose --env-file .env.production -f docker-compose.prod.yml down --remove-orphans || true
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build

# 6. Verify Health
echo -e "\n${BOLD}[5/6] Waiting for services to become healthy...${RESET}"
RETRIES=30
SUCCESS=false

for i in $(seq 1 $RETRIES); do
    API_STATUS=$(docker inspect --format='{{json .State.Health.Status}}' nexus-titan-prod-api-1 2>/dev/null || echo "\"starting\"")
    if [ "$API_STATUS" = "\"healthy\"" ]; then
        SUCCESS=true
        break
    fi
    echo -n "."
    sleep 3
done
echo ""

if [ "$SUCCESS" = true ]; then
    echo -e "${GREEN}✓ API service is healthy!${RESET}"
else
    echo -e "${YELLOW}API is still initializing. Check logs with: docker compose -f docker-compose.prod.yml logs api${RESET}"
fi

# 7. Print Deployment Summary
echo -e "\n${BOLD}${GREEN}"
echo "=========================================================="
echo "          NEXUS TITAN IS DEPLOYED LIVE!                   "
echo "=========================================================="
echo -e "${RESET}"
echo -e "Web Client:   ${BOLD}https://${DOMAIN_WEB}${RESET}"
echo -e "API Endpoint: ${BOLD}https://${DOMAIN_API}${RESET}"
echo -e "API Health:   ${BOLD}https://${DOMAIN_API}/health${RESET}"
echo ""
echo -e "${BOLD}Useful Operations Commands:${RESET}"
echo -e "  View running containers: ${CYAN}docker compose -f docker-compose.prod.yml ps${RESET}"
echo -e "  View live logs:          ${CYAN}docker compose -f docker-compose.prod.yml logs -f${RESET}"
echo -e "  View Caddy (SSL) logs:   ${CYAN}docker compose -f docker-compose.prod.yml logs -f caddy${RESET}"
echo -e "  Restart all services:    ${CYAN}docker compose -f docker-compose.prod.yml restart${RESET}"
echo -e "  Stop all services:       ${CYAN}docker compose -f docker-compose.prod.yml down${RESET}"
echo ""
