FROM node:20-alpine

WORKDIR /app

# Копируем манифесты (lock-файл может отсутствовать)
COPY package*.json ./

# Если есть package-lock.json → npm ci, иначе → npm install
RUN if [ -f package-lock.json ]; then \
      npm ci --omit=dev; \
    else \
      npm install --omit=dev; \
    fi

# Теперь исходники
COPY . .

EXPOSE 3000
CMD ["npm","start"]
