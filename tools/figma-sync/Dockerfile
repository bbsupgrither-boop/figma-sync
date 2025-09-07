# минимальный образ Node
FROM node:20-alpine

# рабочая директория
WORKDIR /app

# сначала зависимости
COPY package*.json ./
RUN npm ci --omit=dev

# а теперь исходники
COPY . .

# подсказка о порте (Railway сам передаст PORT в контейнер)
EXPOSE 3000

# запуск
CMD ["npm","start"]
