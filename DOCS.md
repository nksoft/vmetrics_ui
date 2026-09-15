# VictoriaMetrics UI

## Installation

Follow these steps to get the add-on installed on your system:

1. In Home Assistant, navigate to the **Settings > Apps > App Store** panel.
2. Click the **three dots** menu (top right) and select **Repositories**.
3. Add the following URL:
   ```
   https://github.com/nksoft/vmetrics_ui
   ```
4. Find the **VictoriaMetrics UI** add-on and click **Install**.

## How to use

1. Start the add-on.
2. Click **Open Web UI** or navigate to the sidebar panel labeled **VictoriaMetrics UI**.
3. In the add-on configuration, set your VictoriaMetrics URL and credentials if needed.

## Configuration

Add-on configuration:

| Option | Description | Default |
|--------|-------------|---------|
| `vm_url` | HTTP URL of your VictoriaMetrics instance | `http://homeassistant:8428` |
| `vm_username` | Username for basic auth (leave empty if auth is disabled) | `""` |
| `vm_password` | Password for basic auth (leave empty if auth is disabled) | `""` |
| `log_level` | Logging level | `info` |

## Features

- **Database Explorer** — Browse metrics organized by Home Assistant domains
- **Data Table** — View, sort, and filter entity data with pagination
- **Chart View** — Line, area, and bar charts with zoom
- **Query Console** — MetricsQL editor
- **Time Range Picker** — 15 minutes to 1 year
- **Favorites** — Star entities for quick access
- **CSV Export** — Download data as CSV
- **InfluxDB Migration** — Import historical data from InfluxDB v1

## Requirements

- [VictoriaMetrics](https://victoriametrics.com/) running as a Home Assistant add-on or external instance
- Home Assistant 2026.2 or newer

## Warning

**Use this software at your own risk.** This add-on provides direct access to your VictoriaMetrics database, including the ability to view and delete data. The author is **not responsible** for any data loss, corruption, or other damage that may result from using this application. Always maintain backups of your data before making changes.

## Support

Got questions? Open an issue at [GitHub](https://github.com/nksoft/vmetrics_ui/issues).

- [Home Assistant Community Forum](https://community.home-assistant.io/)
- [Home Assistant Discord Chat](https://discord.gg/cnDmVn3V)
