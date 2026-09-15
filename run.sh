#!/bin/bash
set -e

VM_URL="${VM_URL:-http://homeassistant:8428}"
VM_USERNAME="${VM_USERNAME:-}"
VM_PASSWORD="${VM_PASSWORD:-}"

if [ -f /data/options.json ]; then
  VM_URL=$(python3 -c "import json; d=json.load(open('/data/options.json')); print(d.get('vm_url','$VM_URL'))")
  VM_USERNAME=$(python3 -c "import json; d=json.load(open('/data/options.json')); print(d.get('vm_username',''))")
  VM_PASSWORD=$(python3 -c "import json; d=json.load(open('/data/options.json')); print(d.get('vm_password',''))")
fi

export VM_URL VM_USERNAME VM_PASSWORD

cd /app
exec python3 -m uvicorn main:app --host 0.0.0.0 --port 3000 --log-level info
