FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV ERP_HOST=0.0.0.0
ENV ERP_PORT=8088
ENV ERP_COOKIE_SECURE=auto

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app

RUN mkdir -p /app/data/uploads /app/data/samples /app/data/backups \
    && useradd --create-home --shell /usr/sbin/nologin erp \
    && chown -R erp:erp /app/data

USER erp

EXPOSE 8088

CMD ["python", "server.py"]
