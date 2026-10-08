FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY frontend ./frontend

RUN useradd -m geospots && mkdir -p /app/data && chown geospots /app/data
USER geospots

ENV DATA_DIR=/app/data
VOLUME ["/app/data"]
EXPOSE 8080
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
