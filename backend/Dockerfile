# syntax=docker/dockerfile:1.4
# Stage 1: Builder
FROM golang:1.24-alpine AS builder

WORKDIR /src

# Cache Go modules layer
COPY go.mod go.sum ./
RUN go mod download

# Copy backend source tree
COPY . .

# Compile optimized static binaries
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-w -s" -o /bin/aura-api ./cmd/api
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-w -s" -o /bin/aura-migrate ./cmd/migrate

# Stage 2: Unprivileged Secure Runtime
FROM alpine:3.20 AS runner

RUN apk add --no-cache ca-certificates tzdata curl \
    && addgroup -g 10001 -S appgroup \
    && adduser -u 10001 -S appuser -G appgroup

WORKDIR /app

COPY --from=builder /bin/aura-api /app/aura-api
COPY --from=builder /bin/aura-migrate /app/aura-migrate

RUN mkdir -p /app/data/media && chown -R appuser:appgroup /app

USER 10001:10001

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/healthz || exit 1

ENTRYPOINT ["/app/aura-api"]
