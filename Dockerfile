FROM node:18-bullseye

# Install Ghostscript
RUN apt-get update && apt-get install -y ghostscript zip && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy all app files
COPY . .

# Install dependencies
RUN npm install

# Create necessary runtime folders
RUN mkdir -p uploads outputs

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
