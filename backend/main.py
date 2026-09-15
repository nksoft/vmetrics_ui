import os
import sys
import asyncio
import logging
from collections import defaultdict
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse
from typing import Optional
import json
import csv
import io

logging.basicConfig(
    format="%(asctime)s %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
    level=logging.INFO,
    stream=sys.stdout,
)

log = logging.getLogger("vmetrics_ui.main")

from vm_client import VMClient
from models import (
    TableInfo,
    ImportedTableInfo,
    TableSchema,
    TableDataRequest,
    TableDataResponse,
    QueryRequest,
    QueryResponse,
    HealthResponse,
    StatusResponse,
    SchemaRequest,
    DeleteRequest,
    InfluxConnectRequest,
    InfluxConnectResponse,
    InfluxInspectRequest,
    InfluxInspectResponse,
    MeasurementDetail,
    MigrationStartRequest,
    MigrationStatusResponse,
)
from influx_client import InfluxClient
from migrator import migrator

app = FastAPI(title="VictoriaMetrics UI")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

VM_URL = os.environ.get("VM_URL", "http://homeassistant:8428")
VM_USERNAME = os.environ.get("VM_USERNAME", "")
VM_PASSWORD = os.environ.get("VM_PASSWORD", "")


def get_client() -> VMClient:
    return VMClient(VM_URL, VM_USERNAME, VM_PASSWORD)


@app.get("/api/health")
async def health() -> HealthResponse:
    client = get_client()
    ok = await client.health_check()
    total = await client.get_total_series()
    return HealthResponse(
        status="ok" if ok else "error",
        vm_url=VM_URL,
        series_count=total,
    )


@app.get("/api/status")
async def status() -> StatusResponse:
    client = get_client()
    ok = await client.health_check()
    domains = await client.get_label_values("domain")
    total = await client.get_total_series()

    log.info("[STATUS] connected=%s domains=%d series=%d", ok, len(domains), total)

    return StatusResponse(
        connected=ok,
        vm_url=VM_URL,
        total_metrics=len(domains),
        total_series=total,
    )


@app.get("/api/tables")
async def list_tables(lookback: str = "7d") -> list[TableInfo]:
    client = get_client()

    # Get all db values
    try:
        db_values = await client.get_label_values("db", lookback=lookback)
    except Exception:
        db_values = []

    # If no db values, query all domains without db filter
    if not db_values:
        db_values = [""]

    all_tables = []
    for db in db_values:
        # Build match filter
        if db:
            match = f'{{db="{db}"}}'
        else:
            match = "{}"

        # Get domains for this db
        try:
            if db:
                domains = await client.get_label_values_for("domain", match, lookback=lookback)
            else:
                # For HA data (no db tag), get domains not in any db
                all_db_domains = set()
                for d in db_values:
                    try:
                        db_domains = await client.get_label_values_for("domain", f'{{db="{d}"}}', lookback=lookback)
                        all_db_domains.update(db_domains)
                    except Exception:
                        pass
                all_domains = await client.get_label_values("domain", lookback=lookback)
                domains = [d for d in all_domains if d not in all_db_domains]
        except Exception:
            domains = []

        async def fetch_entities(domain: str) -> tuple[str, list[str], dict[str, str]]:
            # Build match with db filter
            if db:
                match = f'{{domain="{domain}", db="{db}"}}'
                entity_ids, units = await asyncio.gather(
                    client.get_entity_ids_with_data(match, lookback=lookback),
                    client.get_entity_units(domain, lookback=lookback),
                )
            else:
                # HA data: get all entities with data, then exclude those with db tags
                all_eids, db_eids_sets, units = await asyncio.gather(
                    client.get_entity_ids_with_data(f'{{domain="{domain}"}}', lookback=lookback),
                    asyncio.gather(*[
                        client.get_entity_ids_with_data(f'{{domain="{domain}", db="{d}"}}', lookback=lookback)
                        for d in db_values if d
                    ]),
                    client.get_entity_units(domain, lookback=lookback),
                )
                # Collect all entity_ids that belong to any db
                db_eids = set()
                for s in db_eids_sets:
                    db_eids.update(s)
                entity_ids = [eid for eid in all_eids if eid not in db_eids]

            log.info("[TABLES] db=%s domain=%s entity_ids=%s%s total=%d", db or 'ha', domain, entity_ids[:5], '...' if len(entity_ids) > 5 else '', len(entity_ids))
            return domain, entity_ids, units

        results = await asyncio.gather(*(fetch_entities(d) for d in domains))

        for domain, entity_ids, units in sorted(results):
            for eid in sorted(entity_ids):
                all_tables.append(
                    TableInfo(
                        name=eid,
                        prefix=domain,
                        series_count=0,
                        label_keys=[],
                        unit=units.get(eid),
                        db=db,
                    )
                )

    log.info("[TABLES] total tables=%d", len(all_tables))
    return all_tables


@app.get("/api/imported-tables")
async def list_imported_tables(lookback: str = "7d") -> list[ImportedTableInfo]:
    """Get imported data grouped by source batch and domain."""
    client = get_client()

    # Get all import batches
    try:
        source_values = await client.get_label_values("source", lookback=lookback)
        import_batches = [v for v in source_values if v.startswith("influxdb_")]
    except Exception:
        return []

    if not import_batches:
        return []

    tables = []
    for source_tag in sorted(import_batches):
        # Get domains for this import batch
        try:
            domains = await client.get_label_values_for(
                "domain", f'{{source="{source_tag}"}}', lookback=lookback
            )
        except Exception:
            domains = []

        for domain in sorted(domains):
            try:
                entity_ids = await client.get_entity_ids_with_data(
                    f'{{domain="{domain}", source="{source_tag}"}}', lookback=lookback
                )
            except Exception:
                entity_ids = []

            # Get db names for this source+domain
            try:
                db_values = await client.get_label_values_for(
                    "db", f'{{domain="{domain}", source="{source_tag}"}}', lookback=lookback
                )
            except Exception:
                db_values = []

            db_name = db_values[0] if db_values else ""

            for eid in sorted(entity_ids):
                tables.append(
                    ImportedTableInfo(
                        name=eid,
                        prefix=domain,
                        source_tag=source_tag,
                        series_count=0,
                        db=db_name,
                    )
                )

    log.info("[IMPORTED] total imported tables=%d", len(tables))
    return tables


@app.post("/api/schema")
async def get_table_schema(body: SchemaRequest) -> TableSchema:
    client = get_client()
    domain = body.metric
    entity_id = body.entity_id or ""
    try:
        match = f'{{domain="{domain}"'
        if entity_id:
            match += f', entity_id="{entity_id}"'
        match += "}"
        series = await client.get_series_info(match, "-1h", "now")
        label_keys = set()
        for s in series:
            label_keys.update(s.keys())
        label_keys.discard("__name__")
        columns = ["timestamp", "value"] + sorted(label_keys)
        return TableSchema(name=entity_id or domain, columns=columns)
    except Exception:
        return TableSchema(name=entity_id or domain, columns=["timestamp", "value"])


@app.post("/api/data")
async def get_table_data(body: TableDataRequest) -> TableDataResponse:
    client = get_client()
    domain = body.metric

    entity_ids = body.entity_ids if body.entity_ids else ([body.entity_id] if body.entity_id else [""])

    try:
        # Fetch enough rows from VM to cover filtering + pagination
        fetch_limit = max(body.limit * 20, 10000)
        fetch_limit = min(fetch_limit, 100000)

        all_labels: set[str] = set()
        flat_rows = []

        for eid in entity_ids:
            match = f'{{domain="{domain}"'
            if eid:
                match += f', entity_id="{eid}"'
            if body.db:
                match += f', db="{body.db}"'
            match += "}"

            log.info("[DATA] match=%s start=%s end=%s limit=%d page=%d", match, body.start, body.end, body.limit, body.page)

            raw = await client.export_series(
                metric=match,
                start=body.start,
                end=body.end,
                limit=fetch_limit,
                filters=body.filters,
            )

            log.info("[DATA] %s: got %d raw items", eid or '*', len(raw))

            for item in raw:
                labels = item.get("metric", {})
                values = item.get("values", [])
                timestamps = item.get("timestamps", [])

                if timestamps and values and isinstance(values, list) and not isinstance(values[0], list):
                    all_labels.update(labels.keys())
                    for i in range(min(len(timestamps), len(values))):
                        row = {"timestamp": timestamps[i], "value": values[i]}
                        row.update(labels)
                        flat_rows.append(row)
                elif isinstance(values, list) and values and isinstance(values[0], list):
                    all_labels.update(labels.keys())
                    for ts_val in values:
                        if isinstance(ts_val, list) and len(ts_val) >= 2:
                            ts, val = ts_val[0], ts_val[1]
                            row = {"timestamp": ts, "value": val}
                            row.update(labels)
                            flat_rows.append(row)
                else:
                    single = item.get("value")
                    if single and len(single) >= 2:
                        all_labels.update(labels.keys())
                        row = {"timestamp": single[0], "value": single[1]}
                        row.update(labels)
                        flat_rows.append(row)

        # Sort by timestamp descending (newest first)
        flat_rows.sort(key=lambda r: r.get("timestamp", 0), reverse=True)

        # Extract available sources before filtering
        all_sources = set()
        for r in flat_rows:
            src = r.get("source", "")
            if src:
                all_sources.add(src)
            else:
                all_sources.add("")
        available_sources = sorted(all_sources)

        # Apply filters
        if body.hide_zeroes:
            flat_rows = [r for r in flat_rows if r.get("value") != 0 and r.get("value") != "0"]
        if body.hidden_values:
            hidden_set = set(body.hidden_values)
            flat_rows = [r for r in flat_rows if str(r.get("value")) not in hidden_set]
        if body.source_filter is not None and body.source_filter != "":
            flat_rows = [r for r in flat_rows if r.get("source", "") == body.source_filter]
        elif body.source_filter == "":
            flat_rows = [r for r in flat_rows if r.get("source", "") == ""]

        total = len(flat_rows)

        # Apply pagination
        offset = body.page * body.limit
        page_rows = flat_rows[offset:offset + body.limit]

        columns = ["timestamp", "value"] + sorted(all_labels - {"__name__"})
        return TableDataResponse(
            columns=columns, rows=page_rows, total=total, available_sources=available_sources
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/query")
async def run_query(body: QueryRequest) -> QueryResponse:
    client = get_client()
    try:
        log.info("[QUERY] query=%s start=%s end=%s step=%s", body.query, body.start, body.end, body.step)
        # Always use query_range when start/end are provided for historical data
        if body.step:
            step = body.step
        else:
            # Auto-calculate step based on time range (target ~200 data points)
            try:
                # Parse relative time expressions
                if body.start.startswith("now-"):
                    import re
                    m = re.match(r"now-(\d+)([smhdwy])", body.start)
                    if m:
                        val, unit = int(m.group(1)), m.group(2)
                        multipliers = {"s": 1, "m": 60, "h": 3600, "d": 86400, "w": 604800, "y": 31536000}
                        start_secs = val * multipliers.get(unit, 86400)
                    else:
                        start_secs = 86400
                else:
                    start_secs = 86400
                step_secs = max(start_secs // 200, 1)
                step = str(step_secs)
            except Exception:
                step = "60"
        log.info("[QUERY] using query_range with step=%s", step)
        results = await client.query_range(
            body.query, body.start, body.end, step
        )
        log.info("[QUERY] results count: %d", len(results))

        all_labels: set[str] = set()
        flat_rows = []
        for result in results:
            metric = result.get("metric", {})
            all_labels.update(metric.keys())

            if "values" in result:
                for ts, val in result["values"]:
                    row = {"timestamp": ts, "value": val}
                    row.update(metric)
                    flat_rows.append(row)
            elif "value" in result:
                ts, val = result["value"]
                row = {"timestamp": ts, "value": val}
                row.update(metric)
                flat_rows.append(row)

        columns = ["timestamp", "value"] + sorted(all_labels - {"__name__"})
        return QueryResponse(
            columns=columns, rows=flat_rows, total=len(flat_rows)
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/export")
async def export_data(
    metric: str = Query(...),
    entity_id: str = Query(""),
    start: str = Query(...),
    end: str = Query(...),
    limit: int = Query(1000),
    format: str = Query("csv"),
):
    client = get_client()
    match = f'{{domain="{metric}"'
    if entity_id:
        match += f', entity_id="{entity_id}"'
    match += "}"
    raw = await client.export_series(
        metric=match, start=start, end=end, limit=limit
    )

    all_labels: set[str] = set()
    flat_rows = []
    for item in raw:
        labels = item.get("metric", {})
        values = item.get("values", [])
        timestamps = item.get("timestamps", [])

        if timestamps and values and isinstance(values, list) and not isinstance(values[0], list):
            all_labels.update(labels.keys())
            for i in range(min(len(timestamps), len(values))):
                row = {"timestamp": timestamps[i], "value": values[i]}
                row.update(labels)
                flat_rows.append(row)
        elif isinstance(values, list) and values and isinstance(values[0], list):
            all_labels.update(labels.keys())
            for ts_val in values:
                if isinstance(ts_val, list) and len(ts_val) >= 2:
                    ts, val = ts_val[0], ts_val[1]
                    row = {"timestamp": ts, "value": val}
                    row.update(labels)
                    flat_rows.append(row)
        else:
            single = item.get("value")
            if single and len(single) >= 2:
                all_labels.update(labels.keys())
                row = {"timestamp": single[0], "value": single[1]}
                row.update(labels)
                flat_rows.append(row)

    columns = ["timestamp", "value"] + sorted(all_labels - {"__name__"})

    if format == "json":
        return flat_rows

    output = io.StringIO()
    writer = csv.DictWriter(output, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    writer.writerows(flat_rows)

    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={
            "Content-Disposition": f"attachment; filename={metric}.csv"
        },
    )


@app.post("/api/delete")
async def delete_series(body: DeleteRequest):
    client = get_client()
    try:
        log.info("[DELETE] match=%s", body.match)
        ok = await client.delete_series(body.match)
        if ok:
            return {"status": "ok", "match": body.match}
        raise HTTPException(status_code=502, detail="Delete request failed — check VM logs")
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(e))


# ── Migration endpoints ──────────────────────────────────────────────

@app.post("/api/migration/connect")
async def influx_connect(body: InfluxConnectRequest) -> InfluxConnectResponse:
    influx = InfluxClient(body.url, body.username, body.password)
    ok = await influx.ping()
    if not ok:
        return InfluxConnectResponse(connected=False, databases=[])
    try:
        dbs = await influx.get_databases()
        return InfluxConnectResponse(connected=True, databases=dbs)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/migration/inspect")
async def influx_inspect(body: InfluxInspectRequest) -> InfluxInspectResponse:
    influx = InfluxClient(body.url, body.username, body.password)
    measurements = []
    for db in body.databases:
        try:
            ms = await influx.get_measurements(db)
            for m in ms:
                try:
                    fields = await influx.get_field_keys(db, m)
                    tags = await influx.get_tag_keys(db, m)
                    measurements.append(
                        MeasurementDetail(db=db, name=m, numeric_fields=fields, tag_keys=tags)
                    )
                except Exception:
                    measurements.append(
                        MeasurementDetail(db=db, name=m, numeric_fields=[], tag_keys=[])
                    )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Error inspecting {db}: {e}")
    return InfluxInspectResponse(measurements=measurements)


@app.post("/api/migration/start")
async def migration_start(body: MigrationStartRequest):
    influx = InfluxClient(body.url, body.username, body.password)
    vm_client = get_client()
    vm_auth = vm_client.auth
    vm_url = VM_URL

    # Auto-detect HA mode: if a database has entity_id as a tag, treat it as HA
    ha_dbs = set(body.ha_databases)
    for db in body.databases:
        if db not in ha_dbs:
            try:
                measurements = await influx.get_measurements(db)
                for m in measurements[:3]:  # Check first 3 measurements
                    tags = await influx.get_tag_keys(db, m)
                    if "entity_id" in tags:
                        ha_dbs.add(db)
                        log.info("[MIGRATION] Auto-detected HA mode for %s (has entity_id tag)", db)
                        break
            except Exception:
                pass

    await migrator.start(
        influx=influx,
        vm_url=vm_url,
        vm_auth=vm_auth,
        databases=body.databases,
        ha_databases=list(ha_dbs),
        batch_size=body.batch_size,
    )
    return {"status": "started"}


@app.get("/api/migration/status")
async def migration_status() -> MigrationStatusResponse:
    s = migrator.status
    return MigrationStatusResponse(
        state=s.state,
        message=s.message,
        total_points=s.total_points,
        migrated_points=s.migrated_points,
        current_db=s.current_db,
        current_measurement=s.current_measurement,
        current_db_index=s.current_db_index,
        total_dbs=s.total_dbs,
        current_measurement_index=s.current_measurement_index,
        total_measurements=s.total_measurements,
        speed=s.speed,
        elapsed=s.elapsed,
        errors=s.errors,
        log=s.log,
        source_tag=s.source_tag,
    )


@app.post("/api/migration/cancel")
async def migration_cancel():
    migrator.cancel()
    return {"status": "cancelling"}


@app.get("/api/import-batches")
async def list_import_batches():
    """List all import batches by querying unique source label values."""
    client = get_client()
    try:
        values = await client.get_label_values("source")
        import_batches = [v for v in values if v.startswith("influxdb_")]
        return {"batches": import_batches}
    except Exception as e:
        return {"batches": [], "error": str(e)}


static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.isdir(static_dir):
    app.mount("/assets", StaticFiles(directory=os.path.join(static_dir, "assets")), name="assets")

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(static_dir, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(os.path.join(static_dir, "index.html"))
