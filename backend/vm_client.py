import httpx
import json
import logging
from typing import Optional

log = logging.getLogger("vmetrics_ui.vm")


class VMClient:
    def __init__(self, base_url: str, username: str = "", password: str = ""):
        self.base_url = base_url.rstrip("/")
        self.auth = (username, password) if username and password else None

    async def _get(self, path: str, params: Optional[dict] = None) -> dict:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.base_url}{path}",
                params=params,
                auth=self.auth,
            )
            resp.raise_for_status()
            return resp.json()

    async def _get_text(self, path: str, params: Optional[dict] = None) -> str:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{self.base_url}{path}",
                params=params,
                auth=self.auth,
            )
            resp.raise_for_status()
            return resp.text

    async def health_check(self) -> bool:
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{self.base_url}/health",
                    auth=self.auth,
                )
                return resp.status_code == 200
        except Exception:
            return False

    async def get_total_series(self) -> Optional[int]:
        try:
            data = await self._get(
                "/api/v1/status/tsdb",
                params={"topN": 0},
            )
            return data.get("data", {}).get("totalSeries", None)
        except Exception:
            return None

    async def get_metric_names(self) -> list[str]:
        try:
            data = await self._get("/api/v1/label/__name__/values")
            return data.get("data", [])
        except Exception:
            return []

    async def get_label_values(self, label: str, lookback: str = "7d") -> list[str]:
        try:
            if lookback.startswith("now-") or lookback == "now":
                start = lookback
            elif lookback in ("all", "0"):
                start = "now-36500d"
            else:
                start = f"now-{lookback}"
            log.info("[VM] get_label_values label=%s lookback=%s start=%s", label, lookback, start)
            data = await self._get(
                f"/api/v1/label/{label}/values",
                params={"start": start, "end": "now"},
            )
            result = data.get("data", [])
            log.info("[VM] get_label_values result: %d items", len(result))
            return result
        except Exception as e:
            log.info("[VM] get_label_values error: %s", e)
            return []

    async def get_label_values_for(
        self, label: str, match: str, lookback: str = "7d"
    ) -> list[str]:
        try:
            if lookback.startswith("now-") or lookback == "now":
                start = lookback
            elif lookback in ("all", "0"):
                start = "now-36500d"
            else:
                start = f"now-{lookback}"
            log.info("[VM] get_label_values_for label=%s match=%s lookback=%s start=%s", label, match, lookback, start)
            data = await self._get(
                f"/api/v1/label/{label}/values",
                params={"match[]": match, "start": start, "end": "now"},
            )
            result = data.get("data", [])
            log.info("[VM] get_label_values_for result: %d items", len(result))
            return result
        except Exception as e:
            log.info("[VM] get_label_values_for error: %s", e)
            return []

    async def get_entity_ids_with_data(
        self, match: str, lookback: str = "7d"
    ) -> list[str]:
        """Get entity_ids that have actual data in the time range using count_over_time query."""
        try:
            # Convert lookback to a duration for count_over_time
            if lookback.startswith("now-"):
                duration = lookback[4:]  # e.g. "15m", "1h", "24h"
            elif lookback in ("all", "0"):
                duration = "365d"
            else:
                duration = lookback  # already a duration like "7d"

            query = f'count_over_time({match}[{duration}])'
            log.info("[VM] get_entity_ids_with_data match=%s lookback=%s query=%s", match, lookback, query)
            results = await self.query_instant(query)
            entity_ids = set()
            for r in results:
                labels = r.get("metric", {})
                eid = labels.get("entity_id", "") or labels.get("entity", "")
                if eid:
                    entity_ids.add(eid)
            result = list(entity_ids)
            log.info("[VM] get_entity_ids_with_data result: %d items", len(result))
            return result
        except Exception as e:
            log.info("[VM] get_entity_ids_with_data error: %s", e)
            return []

    async def get_series_info(
        self, match: str, start: str, end: str
    ) -> list[dict]:
        try:
            data = await self._get(
                "/api/v1/series",
                params={"match[]": match, "start": start, "end": end},
            )
            return data.get("data", [])
        except Exception:
            return []

    async def export_series(
        self,
        metric: str,
        start: str,
        end: str,
        limit: int = 100,
        filters: Optional[dict[str, str]] = None,
    ) -> list[dict]:
        match_expr = metric.rstrip("}")
        if filters:
            for k, v in filters.items():
                if v:
                    match_expr += f', {k}="{v}"'
        match_expr += "}"

        params = {
            "match[]": match_expr,
            "start": start,
            "end": end,
        }

        text = await self._get_text("/api/v1/export", params=params)
        rows = []
        for line in text.strip().split("\n"):
            if not line:
                continue
            try:
                obj = json.loads(line)
                rows.append(obj)
            except json.JSONDecodeError:
                continue
        return rows

    async def query_range(
        self,
        query: str,
        start: str,
        end: str,
        step: str = "60",
    ) -> list[dict]:
        data = await self._get(
            "/api/v1/query_range",
            params={
                "query": query,
                "start": start,
                "end": end,
                "step": step,
            },
        )
        results = data.get("data", {}).get("result", [])
        return results

    async def query_instant(self, query: str, time: Optional[str] = None) -> list[dict]:
        params: dict = {"query": query}
        if time:
            params["time"] = time
        log.info("[VM] query_instant query=%s time=%s", query, time)
        data = await self._get("/api/v1/query", params=params)
        status = data.get("status", "")
        results = data.get("data", {}).get("result", [])
        log.info("[VM] query_instant status=%s results=%d", status, len(results))
        if not results:
            log.info("[VM] query_instant raw response: %s", str(data)[:500])
        return results

    async def delete_series(self, match: str) -> bool:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{self.base_url}/api/v1/admin/tsdb/delete_series",
                data={"match[]": match},
                auth=self.auth,
            )
            log.info("[VM] delete_series status=%d body=%s", resp.status_code, resp.text[:200])
            return resp.status_code == 204

    async def get_entity_units(
        self, domain: str, lookback: str = "7d"
    ) -> dict[str, str]:
        """Get unit_of_measurement for each entity_id in a domain."""
        try:
            if lookback.startswith("now-") or lookback == "now":
                start = lookback
            elif lookback in ("all", "0"):
                start = "now-36500d"
            else:
                start = f"now-{lookback}"
            data = await self._get(
                "/api/v1/series",
                params={
                    "match[]": f'{{domain="{domain}"}}',
                    "start": start,
                    "end": "now",
                },
            )
            result = {}
            for s in data.get("data", []):
                # VM may use either "entity_id" or "entity" as the label
                eid = s.get("entity_id", "") or s.get("entity", "")
                unit = s.get("unit_of_measurement", "")
                if eid and unit:
                    result[eid] = unit
            return result
        except Exception as e:
            log.info("[VM] get_entity_units error for %s: %s", domain, e)
            return {}
