#!/bin/bash
set -e

REMOTE_HOST="10.0.0.2"
REMOTE_USER="root"
REMOTE_DIR="/root/animu"
BACKUP_DIR="/root/animu-backup"
TAR_FILE="animu-deploy.tar.gz"

echo "=== Animu Python Deployment Script ==="
echo "Target: ${REMOTE_USER}@${REMOTE_HOST}:${REMOTE_DIR}"
echo ""

# 1. Pack the workspace locally
echo "Packing local workspace into ${TAR_FILE}..."
tar -czf ${TAR_FILE} \
    --exclude="node_modules" \
    --exclude="venv" \
    --exclude=".git" \
    --exclude="logs" \
    --exclude="${TAR_FILE}" \
    .

# 2. Check remote and prepare backup
echo "Connecting to remote container to manage backup..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "
  if [ -d '${REMOTE_DIR}' ]; then
    echo 'Found existing old deployment. Creating backup at ${BACKUP_DIR}...'
    rm -rf ${BACKUP_DIR}
    mv ${REMOTE_DIR} ${BACKUP_DIR}
  fi
  mkdir -p ${REMOTE_DIR}/logs
"

# 3. Upload the archive
echo "Uploading package to remote..."
scp ${TAR_FILE} ${REMOTE_USER}@${REMOTE_HOST}:/tmp/${TAR_FILE}
rm ${TAR_FILE}

# 4. Extract and run remote config
echo "Configuring environment on remote container..."
ssh ${REMOTE_USER}@${REMOTE_HOST} "
  # Extract
  tar -xzf /tmp/${TAR_FILE} -C ${REMOTE_DIR}/
  rm -f /tmp/${TAR_FILE}
  
  cd ${REMOTE_DIR}
  
  # Restore profile.json and offline-cache.json for migration
  if [ -f '${BACKUP_DIR}/profile.json' ]; then
    echo 'Restoring configuration file profile.json...'
    cp ${BACKUP_DIR}/profile.json ${REMOTE_DIR}/profile.json
  fi
  if [ -f '${BACKUP_DIR}/logs/offline-cache.json' ]; then
    echo 'Restoring offline cache for pocketbase migration...'
    cp ${BACKUP_DIR}/logs/offline-cache.json ${REMOTE_DIR}/logs/offline-cache.json
  fi

  # Create virtual environment
  echo 'Creating Python virtual environment...'
  python3 -m venv venv
  ./venv/bin/pip install --upgrade pip
  ./venv/bin/pip install -r requirements.txt
  
  # Run cache migration to PocketBase
  echo 'Running offline cache migration to PocketBase...'
  ./venv/bin/python3 migrate_cache.py
  
  # Set up systemd service
  echo 'Installing systemd service file...'
  cp animu.service /etc/systemd/system/animu.service
  systemctl daemon-reload
  systemctl enable animu.service
  
  # Stop and clean up old PM2 processes if running
  if command -v pm2 &> /dev/null; then
    echo 'Stopping old PM2 process...'
    pm2 delete Animu || true
    pm2 save || true
  fi
  
  # Start the new systemd service
  echo 'Starting animu systemd service...'
  systemctl restart animu.service
  
  echo 'Checking service status...'
  systemctl status animu.service --no-pager
"

echo ""
echo "=== Deployment Completed Successfully! ==="
