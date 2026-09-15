# VictoriaMetrics UI

A database-explorer-style web interface for [VictoriaMetrics](https://victoriametrics.com/), designed as a Home Assistant add-on. Browse your metrics without writing queries.

## Features

- **Database Explorer** — Browse metrics organized by Home Assistant domains (sensor, climate, input_number, etc.)
- **Data Table** — View, sort, and filter entity data with pagination
- **Chart View** — Line, area, and bar charts with drag-to-zoom and CTRL+scroll zoom
- **Query Console** — MetricsQL editor with historical data via query_range
- **Time Range Picker** — Preset ranges from 15 minutes to 1 year, plus custom
- **Favorites** — Star entities for quick access
- **CSV Export** — Download data as CSV
- **InfluxDB Migration** — Import historical data from InfluxDB v1 into VictoriaMetrics
- **Multiple Themes** — 5 built-in themes with chart colors that adapt

## Installation

1. In Home Assistant, go to **Settings > Apps > App Store**
2. Click the **three dots** menu (top right) and select **Repositories**
3. Paste the following URL and click **Add**:

```
https://github.com/nksoft/vmetrics_ui
```

4. Find **VictoriaMetrics UI** in the store and click **Install**
5. Configure your VictoriaMetrics URL and credentials in the add-on settings
6. Start the add-on and click **Open Web UI**

## Configuration

| Option | Description | Default |
|--------|-------------|---------|
| `vm_url` | VictoriaMetrics HTTP URL | `http://homeassistant:8428` |
| `vm_username` | Username for basic auth (leave empty if disabled) | `` |
| `vm_password` | Password for basic auth (leave empty if disabled) | `` |

## Requirements

- [VictoriaMetrics](https://victoriametrics.com/) running as a Home Assistant add-on or external instance
- Home Assistant 2026.2 or newer

## Supported Architectures

- amd64
- aarch64
- armv7

## Screenshots

_TBD_

## Support

- [Report a bug](https://github.com/nksoft/vmetrics_ui/issues)
- [Home Assistant Community Forum](https://community.home-assistant.io/)

## Disclaimer

**Use this software at your own risk.** This add-on provides direct access to your VictoriaMetrics database, including the ability to view and delete data. The author is **not responsible** for any data loss, corruption, or other damage that may result from using this application. Always maintain backups of your data before making changes.

## License

MIT
