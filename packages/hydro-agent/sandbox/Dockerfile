FROM python:3.14-slim-trixie
RUN apt-get update && apt-get install -y --no-install-recommends g++ openjdk-21-jdk-headless \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /work
COPY testlib/testlib.h /opt/testlib/testlib.h
