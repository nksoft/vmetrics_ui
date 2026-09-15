import httpx
import json
import logging
from typing import Optional, AsyncIterator

log = logging.getLogger("vmetrics_ui.influx")


class InfluxClient:
    def __init__(self, base_url: str, username: str = "", password: str = ""):
        self.base_url = base_url.rstrip("/")
        self.auth = (username, password) if username and password else None

    async def ping(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self.base_url}/ping",
                    auth=self.auth,
                )
                return resp.status_code == 204 or resp.status_code == 200
        except Exception:
            return False

    async def get_databases(self) -> list[str]:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{self.base_url}/query",
                params={"q": "SHOW DATABASES"},
                auth=self.auth,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [{}])
            if not results:
                return []
            values = results[0].get("series", [{}])[0].get("values", [])
            databases = [row[0] for row in values]
            return [d for d in databases if d != "_internal"]

    async def get_measurements(self, db: str) -> list[str]:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.base_url}/query",
                params={
                    "q": "SHOW MEASUREMENTS",
                    "db": db,
                    "epoch": "ms",
                },
                auth=self.auth,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [{}])
            if not results:
                return []
            values = results[0].get("series", [{}])[0].get("values", [])
            measurements = [row[0] for row in values]
            log.info("[INFLUX] get_measurements db=%s: found %d measurements", db, len(measurements))
            return measurements

    async def get_field_keys(self, db: str, measurement: str) -> list[str]:
        """Get numeric field keys for a measurement."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{self.base_url}/query",
                params={
                    "q": f'SHOW FIELD KEYS FROM "{measurement}"',
                    "db": db,
                },
                auth=self.auth,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [{}])
            if not results:
                return []
            values = results[0].get("series", [{}])[0].get("values", [])
            # Field keys format: [field_name, field_type]
            all_fields = [(row[0], row[1]) for row in values]
            numeric = [row[0] for row in values if row[1] in ("float", "integer", "boolean")]
            log.info("[INFLUX] get_field_keys db=%s m=%s: all=%s, numeric=%s", db, measurement, all_fields, numeric)
            return numeric

    async def get_tag_keys(self, db: str, measurement: str) -> list[str]:
        """Get tag keys for a measurement."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{self.base_url}/query",
                params={
                    "q": f'SHOW TAG KEYS FROM "{measurement}"',
                    "db": db,
                },
                auth=self.auth,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [{}])
            if not results:
                return []
            values = results[0].get("series", [{}])[0].get("values", [])
            tags = [row[0] for row in values]
            log.info("[INFLUX] get_tag_keys db=%s m=%s: %s", db, measurement, tags)
            return tags

    async def get_series_count(self, db: str, measurement: str) -> int:
        """Get count of series for a measurement."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{self.base_url}/query",
                params={
                    "q": f'SHOW SERIES FROM "{measurement}"',
                    "db": db,
                },
                auth=self.auth,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [{}])
            if not results:
                return 0
            values = results[0].get("series", [{}])[0].get("values", [])
            return len(values)

    async def get_point_count(self, db: str, measurement: str) -> int:
        """Get actual data point count for a measurement."""
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.base_url}/query",
                params={
                    "q": f'SELECT count("value") FROM "{measurement}"',
                    "db": db,
                },
                auth=self.auth,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [{}])
            if not results:
                return 0
            series = results[0].get("series", [])
            if not series:
                return 0
            values = series[0].get("values", [])
            if not values:
                return 0
            # count returns [[time, count_value]]
            count_val = values[0][1] if len(values[0]) > 1 else 0
            log.info("[INFLUX] get_point_count db=%s m=%s: %s", db, measurement, count_val)
            return count_val or 0

    async def get_measurement_time_range(self, db: str, measurement: str) -> tuple[Optional[int], Optional[int]]:
        """Get earliest and latest timestamps (epoch ms) for a measurement."""
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                f"{self.base_url}/query",
                params={
                    "q": f'SELECT FIRST("value"), LAST("value") FROM "{measurement}"',
                    "db": db,
                    "epoch": "ms",
                },
                auth=self.auth,
            )
            resp.raise_for_status()
            data = resp.json()
            results = data.get("results", [{}])
            if not results:
                return None, None
            series = results[0].get("series", [{}])
            if not series:
                return None, None
            values = series[0].get("values", [])
            if not values:
                return None, None
            # values format: [[time, first_val], ...] - we just need the time
            row = values[0]
            # row[0] is time, row[1] is first, row[2] is last
            first_time = row[0] if len(row) > 0 else None
            last_time = row[0] if len(row) > 1 else first_time
            # Actually the query returns [[time, first_val], [time, last_val]]
            # Let's fix this
            first_time = values[0][0] if values else None
            last_time = values[-1][0] if len(values) > 1 else first_time
            return first_time, last_time

    async def stream_records(
        self,
        db: str,
        measurement: str,
        chunk_size: int = 5000,
    ) -> AsyncIterator[dict]:
        """
        Stream records from a measurement using chunked queries.
        Yields raw InfluxDB result chunks as dicts.
        Falls back to non-streaming if chunked fails.
        """
        log.info("[INFLUX] stream_records db=%s measurement=%s chunk_size=%d", db, measurement, chunk_size)
        url = f"{self.base_url}/query"

        # Try non-streaming first (more reliable, logs raw response)
        try:
            params = {
                "q": f'SELECT * FROM "{measurement}"',
                "db": db,
                "epoch": "ms",
            }
            log.info("[INFLUX] non-streaming query: %s", params)
            async with httpx.AsyncClient(timeout=300.0) as client:
                resp = await client.get(url, params=params, auth=self.auth)
                resp.raise_for_status()
                data = resp.json()
                results = data.get("results", [{}])
                series_count = 0
                total_values = 0
                for r in results:
                    for s in r.get("series", []):
                        series_count += 1
                        vals = s.get("values", [])
                        total_values += len(vals)
                        log.info("[INFLUX] series '%s': %d rows, columns=%s", s.get('name'), len(vals), s.get('columns'))
                log.info("[INFLUX] non-streaming result: %d series, %d total rows", series_count, total_values)
                # Yield the full result as a single chunk
                for r in results:
                    if r.get("series"):
                        yield r
                return
        except Exception as e:
                log.info("[INFLUX] non-streaming failed: %s, trying streaming", e)

        # Fallback to streaming
        async with httpx.AsyncClient(timeout=120.0) as client:
            params = {
                "q": f'SELECT * FROM "{measurement}"',
                "db": db,
                "epoch": "ms",
                "chunked": "true",
                "chunk_size": str(chunk_size),
            }
            log.info("[INFLUX] streaming query: %s", params)
            async with client.stream(
                "GET", url, params=params, auth=self.auth
            ) as resp:
                log.info("[INFLUX] stream response status=%d", resp.status_code)
                resp.raise_for_status()
                buffer = ""
                chunk_count = 0
                total_rows = 0
                async for chunk in resp.aiter_text():
                    buffer += chunk
                    while "\n" in buffer:
                        line, buffer = buffer.split("\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            data = json.loads(line)
                            chunk_count += 1
                            series = data.get("series", [])
                            for s in series:
                                rows = len(s.get("values", []))
                                total_rows += rows
                            if chunk_count <= 3 or chunk_count % 10 == 0:
                                log.info("[INFLUX] chunk #%d: series_count=%d, total_rows_so_far=%d", chunk_count, len(series), total_rows)
                            yield data
                        except json.JSONDecodeError as e:
                            if line:
                                log.info("[INFLUX] JSON parse error: %s line=%s", e, line[:200])
                            continue
                if buffer.strip():
                    try:
                        data = json.loads(buffer.strip())
                        series = data.get("series", [])
                        for s in series:
                            total_rows += len(s.get("values", []))
                        chunk_count += 1
                        log.info("[INFLUX] final chunk: total_chunks=%d, total_rows=%d", chunk_count, total_rows)
                        yield data
                    except json.JSONDecodeError:
                        pass
                log.info("[INFLUX] stream done: total_chunks=%d, total_rows=%d", chunk_count, total_rows)
