from pydantic import BaseModel
from typing import Optional


class TableInfo(BaseModel):
    name: str
    prefix: str
    series_count: int
    label_keys: list[str]
    earliest: Optional[str] = None
    latest: Optional[str] = None
    unit: Optional[str] = None
    db: str = ""


class ImportedTableInfo(BaseModel):
    name: str
    prefix: str
    source_tag: str
    series_count: int
    db: str = ""


class TableSchema(BaseModel):
    name: str
    columns: list[str]


class SchemaRequest(BaseModel):
    metric: str
    entity_id: Optional[str] = None


class TableDataRequest(BaseModel):
    metric: str
    entity_id: Optional[str] = None
    entity_ids: Optional[list[str]] = None
    start: str
    end: str
    limit: int = 100
    page: int = 0
    hide_zeroes: bool = False
    hidden_values: Optional[list[str]] = None
    filters: Optional[dict[str, str]] = None
    step: Optional[str] = None
    source_filter: Optional[str] = None
    db: Optional[str] = None


class TableDataResponse(BaseModel):
    columns: list[str]
    rows: list[dict]
    total: int
    available_sources: Optional[list[str]] = None


class QueryRequest(BaseModel):
    query: str
    start: str
    end: str
    step: Optional[str] = None


class QueryResponse(BaseModel):
    columns: list[str]
    rows: list[dict]
    total: int


class HealthResponse(BaseModel):
    status: str
    vm_url: str
    series_count: Optional[int] = None


class StatusResponse(BaseModel):
    connected: bool
    vm_url: str
    total_metrics: int
    total_series: Optional[int] = None


class DeleteRequest(BaseModel):
    match: str


class InfluxConnectRequest(BaseModel):
    url: str = "http://a0d7b954-influxdb:8086"
    username: str = ""
    password: str = ""


class InfluxConnectResponse(BaseModel):
    connected: bool
    databases: list[str]


class InfluxInspectRequest(BaseModel):
    url: str = "http://a0d7b954-influxdb:8086"
    username: str = ""
    password: str = ""
    databases: list[str]


class MeasurementDetail(BaseModel):
    db: str
    name: str
    numeric_fields: list[str]
    tag_keys: list[str]


class InfluxInspectResponse(BaseModel):
    measurements: list[MeasurementDetail]


class MigrationStartRequest(BaseModel):
    url: str = "http://a0d7b954-influxdb:8086"
    username: str = ""
    password: str = ""
    databases: list[str]
    ha_databases: list[str] = []
    batch_size: int = 5000


class MigrationStatusResponse(BaseModel):
    state: str
    message: str
    total_points: int
    migrated_points: int
    current_db: str
    current_measurement: str
    current_db_index: int
    total_dbs: int
    current_measurement_index: int
    total_measurements: int
    speed: float
    elapsed: float
    errors: list[str]
    log: list[str]
    source_tag: str = ""
