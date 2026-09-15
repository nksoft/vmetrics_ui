FROM node:20-alpine AS frontend-build

WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim

LABEL \
  io.hass.version="1.29.21" \
  io.hass.type="app" \
  io.hass.arch="aarch64|amd64"

WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/main.py backend/models.py backend/vm_client.py backend/entrypoint.py backend/influx_client.py backend/migrator.py ./
RUN mkdir -p static
COPY --from=frontend-build /build/frontend/dist/ ./static/

EXPOSE 3000

CMD ["python3", "entrypoint.py"]
