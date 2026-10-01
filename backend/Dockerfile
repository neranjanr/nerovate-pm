FROM python:3.12-slim
WORKDIR /code
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app
ENV DATABASE_URL=sqlite:////data/nrg.db
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
