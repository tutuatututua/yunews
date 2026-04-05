# Build stage
FROM golang:1.22-alpine AS builder

WORKDIR /app

# Install dependencies first (cache layer)
COPY go.mod ./
RUN go mod download || true

# Copy source
COPY . .

# Ensure dependencies are resolved (handles missing go.sum)
RUN go mod tidy

# Build binary
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-s -w" -o /server ./cmd/server

# Runtime stage
FROM alpine:3.19

RUN apk add --no-cache ca-certificates tzdata

WORKDIR /app

COPY --from=builder /server .

EXPOSE 8080

CMD ["./server"]
