# Use Python 3.11 slim image as base
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies for psutil and pyautogui
RUN apt-get update && apt-get install -y \
    gcc \
    libffi-dev \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Install additional dependencies not in requirements.txt
RUN pip install --no-cache-dir psutil

# Copy the Python script
COPY pc_agent_relay.py .

# Expose any necessary ports if the script listens (check if it does)
# EXPOSE 8080  # Uncomment if needed

# Set environment variables if needed
ENV DOCKER_CONTAINER=1
ENV RELAY_URL=wss://phone-controller-1.onrender.com
# ENV PC_AGENT_TOKEN=redhood
 ENV OLLAMA_MODEL=llama3.2

# Run the script
CMD ["python", "pc_agent_relay.py"]