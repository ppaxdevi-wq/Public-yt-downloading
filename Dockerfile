FROM node:20

# Install Python 3, pip, ffmpeg, and ensure 'python' command exists
RUN apt-get update && apt-get install -y \
    python3-pip \
    ffmpeg \
    python-is-python3

# Install yt-dlp CLI
RUN pip3 install -U yt-dlp --break-system-packages --no-cache-dir

# Install Deno (required by yt-dlp for some features)
RUN curl -fsSL https://deno.land/install.sh | sh
ENV PATH="/root/.deno/bin:${PATH}"

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 10000
CMD ["node", "server.js"]
