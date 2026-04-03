FROM node:18-alpine
WORKDIR /app

# Install deps and run as non-root user for safety
RUN addgroup -S app && adduser -S app -G app
USER app

COPY --chown=app:app package.json package-lock.json* ./
RUN npm install --no-audit --no-fund

COPY --chown=app:app . .

ENV HOST 0.0.0.0
EXPOSE 5173

CMD ["sh", "-c", "npm run dev -- --host 0.0.0.0"]
