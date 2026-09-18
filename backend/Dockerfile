# syntax=docker/dockerfile:1
# Build context is the repository root so the authoritative profile catalog
# (config/machine_profiles.json) can be baked into the image.
FROM maven:3.9.16-eclipse-temurin-25 AS build
WORKDIR /build
COPY backend/pom.xml .
RUN mvn -q -e dependency:go-offline > /dev/null 2>&1 || true
COPY backend/src ./src
RUN mvn -q -DskipTests package

FROM eclipse-temurin:25-jre
WORKDIR /app
COPY --from=build /build/target/forgesense-backend-*.jar app.jar
COPY config /config
ENV FORGESENSE_PROFILES_FILE=/config/machine_profiles.json
RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=30s \
    CMD curl -f http://localhost:8080/actuator/health || exit 1
ENTRYPOINT ["java", "-jar", "app.jar"]