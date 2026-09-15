import os
import json
import sys

vm_url = os.environ.get("VM_URL", "http://homeassistant:8428")
vm_username = os.environ.get("VM_USERNAME", "")
vm_password = os.environ.get("VM_PASSWORD", "")

options_path = "/data/options.json"
if os.path.isfile(options_path):
    try:
        with open(options_path) as f:
            opts = json.load(f)
        vm_url = opts.get("vm_url", vm_url)
        vm_username = opts.get("vm_username", vm_username)
        vm_password = opts.get("vm_password", vm_password)
    except Exception:
        pass

os.environ["VM_URL"] = vm_url
os.environ["VM_USERNAME"] = vm_username
os.environ["VM_PASSWORD"] = vm_password

print(f"Starting VictoriaMetrics UI...")
print(f"Connecting to: {vm_url}")

os.chdir("/app")
os.execv(sys.executable, [
    sys.executable, "-m", "uvicorn", "main:app",
    "--host", "0.0.0.0", "--port", "3000", "--log-level", "info",
])
