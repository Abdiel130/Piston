FROM node:current-alpine

WORKDIR /app

# Copy dependency files first for Docker cache optimization
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy application source
COPY . .

# Expose port 4300
EXPOSE 4300

# Start development server
CMD ["npm", "start"]
