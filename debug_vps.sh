#!/bin/bash

BLUE='\033[0;34m'
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}=== Chibalete VPS Diagnostics ===${NC}"
echo "Date: $(date)"

# 1. Disk Space
echo -e "\n${BLUE}1. Disk Space Usage:${NC}"
df -h / | tail -n 1

# 2. Permissions Check
echo -e "\n${BLUE}2. Checking Permissions for Uploads:${NC}"
UPLOAD_DIR="/var/www/chibalete/public/uploads"
if [ -d "$UPLOAD_DIR" ]; then
    ls -ld $UPLOAD_DIR
    echo "Files inside (top 5):"
    ls -la $UPLOAD_DIR | head -n 8
else
    echo -e "${RED}ERROR: Upload directory does not exist at $UPLOAD_DIR${NC}"
fi

# 3. Write Test
echo -e "\n${BLUE}3. Testing Write Permission:${NC}"
TEST_FILE="$UPLOAD_DIR/debug_test_$(date +%s).txt"
touch $TEST_FILE 2>/dev/null
if [ -f "$TEST_FILE" ]; then
    echo -e "${GREEN}SUCCESS: Can write to uploads directory.${NC}"
    rm $TEST_FILE
else
    echo -e "${RED}ERROR: Cannot write to uploads directory!${NC}"
    echo "Current user: $(whoami)"
fi

# 4. Nginx Config
echo -e "\n${BLUE}4. Checking Nginx Max Body Size:${NC}"
if [ -f /etc/nginx/sites-available/chibalete ]; then
    grep "client_max_body_size" /etc/nginx/sites-available/chibalete
else
    echo -e "${RED}ERROR: Nginx config not found at /etc/nginx/sites-available/chibalete${NC}"
fi

# 5. App Status
echo -e "\n${BLUE}5. PM2 Process Status:${NC}"
pm2 status chibalete-app

# 6. Recent Error Logs
echo -e "\n${BLUE}6. Recent Error Logs (Last 20 lines):${NC}"
pm2 logs chibalete-app --err --lines 20 --nostream

echo -e "\n${BLUE}=== End of Diagnostics ===${NC}"
