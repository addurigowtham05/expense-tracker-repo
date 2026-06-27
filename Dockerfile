FROM python:3.11-slim

# Set up working directory
WORKDIR /code

# Copy requirements and install dependencies
COPY ./backend/requirements.txt /code/requirements.txt
RUN pip install --no-cache-dir --upgrade -r /code/requirements.txt
RUN pip install --no-cache-dir python-dotenv psycopg2-binary

# Copy backend source code
COPY ./backend /code/backend

# Set the environment variable for Supabase
ENV DATABASE_URL=postgresql://postgres:CbRoXymbtTQu8B7k@db.fdeoxtmjfhlsijqltytm.supabase.co:5432/postgres

# Hugging Face runs on port 7860
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
