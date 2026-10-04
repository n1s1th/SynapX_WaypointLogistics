import os
import psycopg2
from dotenv import load_dotenv

load_dotenv()
conn = psycopg2.connect(os.getenv("DATABASE_URL_UNPOOLED"))
cur = conn.cursor()
cur.execute("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'outlets' ORDER BY ordinal_position")
for row in cur.fetchall():
    print(row)
cur.close()
conn.close()
