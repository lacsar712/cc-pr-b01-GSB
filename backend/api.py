import os
from datetime import datetime, timedelta, timezone

import psycopg
from fastapi import Depends, FastAPI, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel
from psycopg.rows import dict_row

DSN = os.environ.get("DATABASE_URL", "postgresql://app:app@localhost:54394/printreg")
SECRET = os.environ.get("JWT_SECRET", "print-register-dev-secret")
pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)
USERS = {
    "printer": {"role": "writer", "password_hash": pwd.hash("print123456")},
    "checker": {"role": "reader", "password_hash": pwd.hash("check123456")},
}


def connect():
    return psycopg.connect(DSN, row_factory=dict_row)


SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
    id serial PRIMARY KEY,
    sheet text NOT NULL,
    cyan_mm double precision NOT NULL,
    magenta_mm double precision NOT NULL,
    status text NOT NULL,
    verdict text NOT NULL DEFAULT '',
    reason text NOT NULL DEFAULT '',
    created_by text NOT NULL,
    created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS requeue_logs (
    id serial PRIMARY KEY,
    job_id integer NOT NULL REFERENCES jobs(id),
    cyan_before double precision NOT NULL,
    cyan_after double precision NOT NULL,
    magenta_before double precision NOT NULL,
    magenta_after double precision NOT NULL,
    changed_by text NOT NULL,
    changed_at timestamptz NOT NULL
);
"""


class LoginIn(BaseModel):
    username: str
    password: str


class JobIn(BaseModel):
    sheet: str
    cyan_mm: float
    magenta_mm: float


class DeviationIn(BaseModel):
    cyan_mm: float
    magenta_mm: float


def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> dict:
    if credentials is None:
        raise HTTPException(status_code=401, detail="未登录")
    try:
        payload = jwt.decode(credentials.credentials, SECRET, algorithms=["HS256"])
    except JWTError as exc:
        raise HTTPException(status_code=401, detail="无效令牌") from exc
    if payload.get("sub") not in USERS:
        raise HTTPException(status_code=401, detail="无效令牌")
    return {"username": payload["sub"], "role": payload.get("role")}


def require_writer(user: dict = Depends(current_user)) -> dict:
    if user["role"] != "writer":
        raise HTTPException(status_code=403, detail="仅印刷员可送复核")
    return user


app = FastAPI(title="印刷套准复核台")


@app.on_event("startup")
def startup():
    with connect() as conn:
        conn.execute(SCHEMA)
        n = conn.execute("SELECT COUNT(*) AS n FROM jobs").fetchone()["n"]
        if n == 0:
            now = datetime.now(timezone.utc)
            conn.execute(
                """INSERT INTO jobs (sheet, cyan_mm, magenta_mm, status, verdict, reason, created_by, created_at)
                   VALUES
                   ('封面-01', 0.05, -0.04, 'pending', '', '', 'printer', %s),
                   ('内页-09', 0.40, 0.02, 'pending', '', '', 'printer', %s)""",
                (now, now),
            )
        conn.commit()


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "print-register-review"}


@app.post("/api/auth/login")
def login(body: LoginIn):
    user = USERS.get(body.username.strip())
    if not user or not pwd.verify(body.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="用户名或密码错误")
    exp = datetime.now(timezone.utc) + timedelta(hours=8)
    token = jwt.encode({"sub": body.username.strip(), "role": user["role"], "exp": exp}, SECRET, algorithm="HS256")
    return {"access_token": token, "username": body.username.strip(), "role": user["role"]}


@app.get("/api/jobs")
def list_jobs(_user: dict = Depends(current_user)):
    with connect() as conn:
        return conn.execute(
            "SELECT id, sheet, cyan_mm, magenta_mm, status, verdict, reason, created_by FROM jobs ORDER BY id DESC"
        ).fetchall()


@app.post("/api/jobs", status_code=202)
def enqueue(body: JobIn, user: dict = Depends(require_writer)):
    with connect() as conn:
        row = conn.execute(
            """INSERT INTO jobs (sheet, cyan_mm, magenta_mm, status, created_by, created_at)
               VALUES (%s, %s, %s, 'pending', %s, %s)
               RETURNING id, sheet, status, verdict""",
            (body.sheet.strip(), body.cyan_mm, body.magenta_mm, user["username"], datetime.now(timezone.utc)),
        ).fetchone()
        conn.commit()
    return row


@app.get("/api/jobs/{job_id}/requeue-logs")
def requeue_logs(job_id: int, _user: dict = Depends(current_user)):
    with connect() as conn:
        job = conn.execute("SELECT 1 FROM jobs WHERE id = %s", (job_id,)).fetchone()
        if job is None:
            raise HTTPException(status_code=404, detail="待处理记录不存在")
        return conn.execute(
            """SELECT id, job_id, cyan_before, cyan_after, magenta_before, magenta_after,
                      changed_by, changed_at
               FROM requeue_logs WHERE job_id = %s ORDER BY id DESC""",
            (job_id,),
        ).fetchall()


@app.patch("/api/jobs/{job_id}/deviation")
def change_deviation(job_id: int, body: DeviationIn, user: dict = Depends(require_writer)):
    # 待处理（pending）才可改偏差并重新排队；领取中（running）、已出结论（done）不可改。
    with connect() as conn:
        with conn.transaction():
            row = conn.execute(
                "SELECT cyan_mm, magenta_mm, status FROM jobs WHERE id = %s FOR UPDATE",
                (job_id,),
            ).fetchone()
            if row is None:
                raise HTTPException(status_code=404, detail="待处理记录不存在")
            if row["status"] != "pending":
                raise HTTPException(status_code=409, detail="仅待处理记录可改偏差后重新排队")
            now = datetime.now(timezone.utc)
            log = conn.execute(
                """INSERT INTO requeue_logs
                   (job_id, cyan_before, cyan_after, magenta_before, magenta_after, changed_by, changed_at)
                   VALUES (%s, %s, %s, %s, %s, %s, %s)
                   RETURNING id, cyan_before, cyan_after, magenta_before, magenta_after, changed_by, changed_at""",
                (
                    job_id,
                    row["cyan_mm"],
                    body.cyan_mm,
                    row["magenta_mm"],
                    body.magenta_mm,
                    user["username"],
                    now,
                ),
            ).fetchone()
            updated = conn.execute(
                """UPDATE jobs SET cyan_mm = %s, magenta_mm = %s
                   WHERE id = %s
                   RETURNING id, sheet, cyan_mm, magenta_mm, status, verdict""",
                (body.cyan_mm, body.magenta_mm, job_id),
            ).fetchone()
        conn.commit()
    return {"job": updated, "log": log}
