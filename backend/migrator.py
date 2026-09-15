import asyncio
import time
import httpx
import logging
from dataclasses import dataclass, field
from typing import Optional
from influx_client import InfluxClient
from datetime import datetime

log = logging.getLogger("vmetrics_ui.migrate")


@dataclass
class MeasurementInfo:
    db: str
    name: str
    numeric_fields: list[str]
    tag_keys: list[str]


@dataclass
class MigrationStatus:
    state: str = "idle"  # idle, connecting, inspecting, running, completed, cancelled, error
    message: str = ""
    total_points: int = 0
    migrated_points: int = 0
    current_db: str = ""
    current_measurement: str = ""
    current_db_index: int = 0
    total_dbs: int = 0
    current_measurement_index: int = 0
    total_measurements: int = 0
    speed: float = 0.0
    elapsed: float = 0.0
    errors: list[str] = field(default_factory=list)
    log: list[str] = field(default_factory=list)
    source_tag: str = ""

    def to_dict(self) -> dict:
        return {
            "state": self.state,
            "message": self.message,
            "total_points": self.total_points,
            "migrated_points": self.migrated_points,
            "current_db": self.current_db,
            "current_measurement": self.current_measurement,
            "current_db_index": self.current_db_index,
            "total_dbs": self.total_dbs,
            "current_measurement_index": self.current_measurement_index,
            "total_measurements": self.total_measurements,
            "speed": round(self.speed, 0),
            "elapsed": round(self.elapsed, 1),
            "errors": self.errors[-20:],
            "log": self.log[-50:],
            "source_tag": self.source_tag,
        }


class Migrator:
    def __init__(self):
        self.status = MigrationStatus()
        self._cancel_event = asyncio.Event()
        self._pause_event = asyncio.Event()
        self._task: Optional[asyncio.Task] = None
        self._influx: Optional[InfluxClient] = None
        self._vm_url: str = ""
        self._vm_auth: Optional[tuple[str, str]] = None

    def _log(self, msg: str):
        ts = time.strftime("%H:%M:%S")
        self.status.log.append(f"[{ts}] {msg}")
        log.info("[MIGRATE] %s", msg)

    def _escape_measurement(self, name: str) -> str:
        """Escape measurement name for InfluxDB line protocol."""
        return name.replace(" ", "\\ ").replace(",", "\\,")

    def _escape_tag_value(self, val: str) -> str:
        """Escape tag value for InfluxDB line protocol."""
        return val.replace(" ", "\\ ").replace(",", "\\,").replace("=", "\\=")

    def _escape_tag_key(self, key: str) -> str:
        """Escape tag key for InfluxDB line protocol."""
        return key.replace(" ", "\\ ").replace(",", "\\,").replace("=", "\\=")

    def _format_line(
        self, measurement: str, tags: dict, fields: dict, timestamp: int
    ) -> str:
        """Format a single InfluxDB line protocol line."""
        # Measurement
        m = self._escape_measurement(measurement)
        # Tags
        tag_parts = []
        for k, v in sorted(tags.items()):
            if v is not None and v != "":
                tag_parts.append(f"{self._escape_tag_key(k)}={self._escape_tag_value(str(v))}")
        tag_str = "," + ",".join(tag_parts) if tag_parts else ""
        # Fields
        field_parts = []
        for k, v in fields.items():
            if v is None:
                continue
            if isinstance(v, (int, float)):
                field_parts.append(f"{k}={v}")
            elif isinstance(v, str):
                # String fields need quotes in line protocol
                escaped = v.replace('"', '\\"')
                field_parts.append(f'{k}="{escaped}"')
            elif isinstance(v, bool):
                field_parts.append(f"{k}={1 if v else 0}")
        if not field_parts:
            return ""
        field_str = ",".join(field_parts)
        return f"{m}{tag_str} {field_str} {int(timestamp)}"

    async def start(
        self,
        influx: InfluxClient,
        vm_url: str,
        vm_auth: Optional[tuple[str, str]],
        databases: list[str],
        ha_databases: list[str],
        batch_size: int = 5000,
    ):
        """Start a background migration task."""
        if self.status.state == "running":
            return

        self._influx = influx
        self._vm_url = vm_url.rstrip("/")
        self._vm_auth = vm_auth
        self._cancel_event.clear()
        self._pause_event.clear()

        # Timestamp for source tag (local time)
        self._source_tag = f"influxdb_{datetime.now().strftime('%Y_%m_%d_%H_%M_%S')}"
        self._log(f"Source tag: {self._source_tag}")

        self.status = MigrationStatus(state="running", message="Starting migration...")
        self.status.total_dbs = len(databases)
        self.status.source_tag = self._source_tag

        self._task = asyncio.create_task(
            self._run_migration(databases, ha_databases, batch_size)
        )

    def cancel(self):
        """Signal cancellation of the running migration."""
        if self.status.state == "running":
            self._cancel_event.set()
            self._log("Cancellation requested...")

    async def _run_migration(
        self,
        databases: list[str],
        ha_databases: list[str],
        batch_size: int,
    ):
        try:
            start_time = time.time()
            total_migrated = 0

            # Skip counting pass — InfluxDB count() is unreliable for progress
            # Just log measurement info
            for db_idx, db in enumerate(databases):
                measurements = await self._influx.get_measurements(db)
                self._log(f"Database {db}: {len(measurements)} measurements")

            self.status.total_points = 0
            self.status.message = f"Migrating data from {len(databases)} databases..."

            # Second pass: migrate data
            measurement_idx = 0
            for db_idx, db in enumerate(databases):
                if self._cancel_event.is_set():
                    break

                self.status.current_db = db
                self.status.current_db_index = db_idx + 1
                self._log(f"Starting database: {db}")

                try:
                    measurements = await self._influx.get_measurements(db)
                except Exception as e:
                    self._log(f"Error listing measurements in {db}: {e}")
                    self.status.errors.append(f"{db}: {e}")
                    continue

                self.status.total_measurements = len(measurements)

                for m_idx, measurement in enumerate(measurements):
                    if self._cancel_event.is_set():
                        break

                    self.status.current_measurement = measurement
                    self.status.current_measurement_index = m_idx + 1
                    self.status.message = f"{db}/{measurement}"

                    is_ha_db = db in ha_databases

                    try:
                        migrated = await self._migrate_measurement(
                            db, measurement, is_ha_db, batch_size
                        )
                        total_migrated += migrated
                        self.status.migrated_points = total_migrated
                        elapsed = time.time() - start_time
                        self.status.elapsed = elapsed
                        if elapsed > 0:
                            self.status.speed = total_migrated / elapsed
                        self._log(
                            f"Completed {db}/{measurement}: {migrated:,} points "
                            f"({total_migrated:,} total)"
                        )
                    except Exception as e:
                        err_msg = f"{db}/{measurement}: {e}"
                        self._log(f"Error: {err_msg}")
                        self.status.errors.append(err_msg)

            elapsed = time.time() - start_time
            self.status.elapsed = elapsed
            if self._cancel_event.is_set():
                self.status.state = "cancelled"
                self.status.message = f"Migration cancelled after {total_migrated:,} points"
            else:
                self.status.state = "completed"
                self.status.message = (
                    f"Migration complete! {total_migrated:,} points in {elapsed:.1f}s"
                )
            self._log(self.status.message)

        except Exception as e:
            self.status.state = "error"
            self.status.message = f"Migration failed: {e}"
            self.status.errors.append(str(e))
            self._log(f"FATAL: {e}")

    async def _migrate_measurement(
        self,
        db: str,
        measurement: str,
        is_ha_db: bool,
        batch_size: int,
    ) -> int:
        """Migrate a single measurement, returns count of migrated points."""
        # Get numeric fields
        numeric_fields = await self._influx.get_field_keys(db, measurement)
        if not numeric_fields:
            self._log(f"  {db}/{measurement}: no numeric fields, skipping")
            return 0

        # Get tags
        tag_keys = await self._influx.get_tag_keys(db, measurement)
        self._log(f"  {db}/{measurement}: fields={numeric_fields}, tags={tag_keys}, ha_mode={is_ha_db}")

        # Target metric name
        target_measurement = "$" if is_ha_db else measurement

        # For HA mode: measurement name is the unit of measurement (e.g., "W", "kWh", "$")
        unit = measurement if is_ha_db else ""

        migrated = 0
        batch: list[str] = []
        logged_sample = False
        chunk_count = 0

        async for chunk in self._influx.stream_records(db, measurement):
            if self._cancel_event.is_set():
                # Flush remaining batch
                if batch:
                    await self._write_batch(batch)
                    migrated += len(batch)
                return migrated

            chunk_count += 1
            series = chunk.get("series", [])
            if not series:
                if chunk_count <= 2:
                    self._log(f"  {db}/{measurement}: chunk #{chunk_count} has no series (raw keys: {list(chunk.keys())})")
                continue

            for s in series:
                tags = {k: v for k, v in s.get("tags", {}).items()}
                tags["source"] = self._source_tag
                columns = s.get("columns", [])
                values_list = s.get("values", [])

                # Detect HA columns that should become tags (not fields)
                ha_tag_keys = {"domain", "entity_id"}

                if not logged_sample and values_list:
                    self._log(f"  {db}/{measurement}: chunk #{chunk_count} has {len(values_list)} rows, columns={columns}")
                    sample_row = dict(zip(columns, values_list[0]))
                    self._log(f"  {db}/{measurement}: sample row: {sample_row}")
                    self._log(f"  {db}/{measurement}: tags from chunk: {s.get('tags', {})}")
                    logged_sample = True
                elif not logged_sample and not values_list:
                    self._log(f"  {db}/{measurement}: chunk #{chunk_count} series '{s.get('name')}' has 0 values")

                for row in values_list:
                    row_dict = dict(zip(columns, row))
                    ts = row_dict.pop("time", None)
                    if ts is None:
                        continue

                    # Log first row's types for debugging
                    if not logged_sample and values_list:
                        debug_types = {k: f"{type(v).__name__}={v!r}" for k, v in row_dict.items()}
                        self._log(f"  {db}/{measurement}: row types: {debug_types}")
                        logged_sample = True

                    # Extract HA tag-like columns into tags dict
                    for tag_key in ha_tag_keys:
                        if tag_key in row_dict and row_dict[tag_key] is not None:
                            tags[tag_key] = str(row_dict[tag_key])
                            row_dict.pop(tag_key)

                    # Add source database tag
                    tags["db"] = db

                    # For HA mode: if domain is missing, derive from measurement or entity_id
                    if "domain" not in tags:
                        if measurement == "$":
                            tags["domain"] = "sensor"
                        else:
                            tags["domain"] = "sensor"

                    # Add unit of measurement tag for HA mode
                    if unit:
                        tags["unit_of_measurement"] = unit

                    # Build fields from ALL numeric columns in the row (not just metadata)
                    # This preserves min, max, and any other fields in the data
                    all_fields = {}
                    for col, val in row_dict.items():
                        if col in ha_tag_keys:
                            continue
                        if val is None:
                            continue
                        if isinstance(val, (int, float, bool)):
                            all_fields[col] = val

                    if not all_fields:
                        continue

                    primary_field = "value" if "value" in all_fields else next(iter(all_fields))
                    extra_fields = {k: v for k, v in all_fields.items() if k != primary_field}

                    # Write primary value
                    fields = {primary_field: all_fields[primary_field]}
                    line = self._format_line(target_measurement, tags, fields, ts)
                    if line:
                        batch.append(line)

                    # Write extra fields as separate entities (e.g., entity_id_min, entity_id_max)
                    if extra_fields and "entity_id" in tags:
                        for field_name, field_val in extra_fields.items():
                            extra_tags = dict(tags)
                            extra_tags["entity_id"] = f"{tags['entity_id']}_{field_name}"
                            line = self._format_line(target_measurement, extra_tags, {primary_field: field_val}, ts)
                            if line:
                                batch.append(line)

                    if len(batch) >= batch_size:
                        await self._write_batch(batch)
                        migrated += len(batch)
                        self.status.migrated_points += len(batch)
                        elapsed = self.status.elapsed
                        if elapsed > 0:
                            self.status.speed = self.status.migrated_points / elapsed
                        batch = []

        if chunk_count == 0:
            self._log(f"  {db}/{measurement}: stream_records yielded 0 chunks")

        # Flush remaining batch
        if batch:
            await self._write_batch(batch)
            migrated += len(batch)

        self._log(f"  {db}/{measurement}: total migrated {migrated:,} points")
        return migrated

    async def _write_batch(self, lines: list[str]):
        """Write a batch of line protocol lines to VictoriaMetrics."""
        if not lines:
            return
        payload = "\n".join(lines)
        for attempt in range(3):
            try:
                async with httpx.AsyncClient(timeout=60.0) as client:
                    resp = await client.post(
                        f"{self._vm_url}/write",
                        params={"precision": "ms"},
                        content=payload.encode("utf-8"),
                        headers={"Content-Type": "text/plain"},
                        auth=self._vm_auth,
                    )
                    if resp.status_code in (200, 204):
                        return
                    elif resp.status_code == 400:
                        # Log full error details
                        self._log(f"Batch write REJECTED (400): {resp.text[:500]}")
                        if len(lines) <= 3:
                            for l in lines:
                                self._log(f"  line: {l}")
                        else:
                            self._log(f"  first line: {lines[0]}")
                            self._log(f"  last line: {lines[-1]}")
                        return
                    else:
                        raise Exception(f"HTTP {resp.status_code}: {resp.text[:500]}")
            except Exception as e:
                if attempt < 2:
                    self._log(f"Batch write attempt {attempt+1} failed: {e}")
                    await asyncio.sleep(1 * (attempt + 1))
                else:
                    raise


# Global singleton
migrator = Migrator()
