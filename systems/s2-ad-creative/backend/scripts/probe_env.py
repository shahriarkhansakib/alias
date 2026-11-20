import os
import socket
from dotenv import load_dotenv

# Check if .env exists
dotenv_path = os.path.join(os.path.dirname(__file__), "..", ".env")
if os.path.exists(dotenv_path):
    load_dotenv(dotenv_path)

def check_port(host, port):
    try:
        s = socket.create_connection((host, port), timeout=1)
        s.close()
        return True
    except Exception:
        return False

import PIL.features
from PIL import Image, ImageFont, ImageDraw

print("POSTGRES_5432:", check_port("127.0.0.1", 5432))
print("REDIS_6379:", check_port("127.0.0.1", 6379))
print("GEMINI_KEY:", bool(os.getenv("GEMINI_API_KEY")))
print("OPENAI_KEY:", bool(os.getenv("OPENAI_API_KEY")))
print("AWS_KEY:", bool(os.getenv("AWS_ACCESS_KEY_ID")))
print("GCS_BUCKET:", bool(os.getenv("GCS_BUCKET")))
print("ENV_DB_URL:", os.getenv("DATABASE_URL"))

try:
    has_raqm = PIL.features.check("raqm")
except Exception as e:
    has_raqm = f"Error: {e}"
print("PIL_RAQM_AVAILABLE:", has_raqm)

