from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from pypdf import PdfReader
from io import BytesIO
import cgi, hashlib, json, os, re, secrets, sqlite3, time

ROOT = Path(__file__).resolve().parent
DB = ROOT / "stages.db"
ADMIN_EMAIL = os.environ.get("STAGE_ADMIN_EMAIL", "anthonygusatto@hotmail.com").lower()

def db():
    connection = sqlite3.connect(DB); connection.row_factory = sqlite3.Row; return connection
def setup():
    with db() as c:
        c.executescript("""CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY,email TEXT UNIQUE NOT NULL,password TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id INTEGER NOT NULL,expires INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS stages(id INTEGER PRIMARY KEY,user_id INTEGER NOT NULL,name TEXT NOT NULL,status TEXT NOT NULL,start TEXT NOT NULL,end TEXT NOT NULL,notes TEXT NOT NULL DEFAULT '');""")
        c.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email='test-auth@example.invalid')")
        c.execute("DELETE FROM users WHERE email='test-auth@example.invalid'")
def hash_password(password, salt=None):
    salt=salt or secrets.token_bytes(16); value=hashlib.pbkdf2_hmac("sha256",password.encode(),salt,310000); return salt.hex()+":"+value.hex()
def verify_password(password, stored):
    salt, digest=stored.split(":"); return secrets.compare_digest(hash_password(password,bytes.fromhex(salt)).split(":")[1],digest)
def course(pdf_bytes):
    text="\n".join(page.extract_text() or "" for page in PdfReader(BytesIO(pdf_bytes)).pages).replace("\r","")
    dates=re.findall(r"\b(\d{2}/\d{2}/\d{4})\b",text)
    if not dates: raise ValueError("Aucune date n'a été trouvée.")
    lines=[line.strip() for line in text.split("Directeur Administratif",1)[0].split("\n") if line.strip()]
    duration=re.search(r"durée de\s+(\d+(?:[.,]\d+)?)\s*heures",text,re.I)
    iso=lambda date:"-".join(reversed(date.split("/")))
    return {"name":lines[-1] if lines and 3<len(lines[-1])<120 else "Stage importé","start":iso(dates[0]),"end":iso(dates[1] if len(dates)>1 else dates[0]),"notes":f"{duration.group(1).replace('.', ',')} h" if duration else ""}

class Handler(SimpleHTTPRequestHandler):
    def user(self):
        cookie=self.headers.get("Cookie",""); token=next((part.split("=",1)[1] for part in cookie.split("; ") if part.startswith("stage_session=")),None)
        if not token:return None
        with db() as c:return c.execute("SELECT users.id,users.email FROM sessions JOIN users ON users.id=sessions.user_id WHERE token=? AND expires>?",(token,int(time.time()))).fetchone()
    def json(self,payload,status=200,cookie=None):
        body=json.dumps(payload,ensure_ascii=False).encode();self.send_response(status);self.send_header("Content-Type","application/json; charset=utf-8");self.send_header("Content-Length",str(len(body))); 
        if cookie:self.send_header("Set-Cookie",cookie)
        self.end_headers();self.wfile.write(body)
    def read_json(self): return json.loads(self.rfile.read(int(self.headers.get("Content-Length",0))))
    def authenticated(self):
        user=self.user()
        if not user:self.json({"error":"Connexion requise."},401)
        return user
    def is_admin(self, user): return bool(user and user["email"].lower()==ADMIN_EMAIL)
    def admin_required(self):
        user=self.authenticated()
        if user and not self.is_admin(user): self.json({"error":"Accès administrateur requis."},403); return None
        return user
    def do_GET(self):
        if self.path=="/api/me":
            user=self.authenticated()
            if user:self.json({**dict(user),"is_admin":self.is_admin(user)})
        elif self.path=="/api/admin/users":
            if self.admin_required():
                with db() as c:
                    rows=c.execute("SELECT users.id,users.email,COUNT(stages.id) AS stage_count FROM users LEFT JOIN stages ON stages.user_id=users.id GROUP BY users.id ORDER BY users.email").fetchall()
                self.json([dict(row) for row in rows])
        elif self.path=="/api/stages":
            user=self.authenticated()
            if user:
                with db() as c: rows=c.execute("SELECT id,name,status,start,end,notes FROM stages WHERE user_id=? ORDER BY start",(user["id"],)).fetchall()
                self.json([dict(row) for row in rows])
        else: super().do_GET()
    def do_POST(self):
        if self.path in ("/api/register","/api/login"):
            try:
                data=self.read_json();email=data["email"].strip().lower();password=data["password"]
                if len(password)<8:raise ValueError("Le mot de passe doit contenir 8 caractères minimum.")
                with db() as c:
                    if self.path.endswith("register"):
                        c.execute("INSERT INTO users(email,password) VALUES(?,?)",(email,hash_password(password)));uid=c.execute("SELECT id FROM users WHERE email=?",(email,)).fetchone()[0]
                    else:
                        found=c.execute("SELECT id,password FROM users WHERE email=?",(email,)).fetchone()
                        if not found or not verify_password(password,found["password"]):raise ValueError("E-mail ou mot de passe incorrect.")
                        uid=found["id"]
                    token=secrets.token_urlsafe(32);c.execute("INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)",(token,uid,int(time.time())+2592000))
                self.json({"id":uid,"email":email},cookie=f"stage_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000")
            except sqlite3.IntegrityError:self.json({"error":"Cette adresse e-mail possède déjà un compte. Clique sur « J’ai déjà un compte » pour te connecter."},400)
            except Exception as error:self.json({"error":str(error)},400)
        elif self.path=="/api/logout":self.json({"ok":True},cookie="stage_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0")
        elif self.path=="/api/extract-pdf":
            user=self.authenticated()
            if user:
                try:
                    form=cgi.FieldStorage(fp=self.rfile,headers=self.headers,environ={"REQUEST_METHOD":"POST","CONTENT_TYPE":self.headers.get("Content-Type","")});self.json(course(form["pdf"].file.read()))
                except Exception as error:self.json({"error":f"PDF illisible : {error}"},422)
        elif self.path=="/api/stages":
            user=self.authenticated()
            if user:
                try:
                    s=self.read_json();
                    with db() as c:c.execute("INSERT INTO stages(user_id,name,status,start,end,notes) VALUES(?,?,?,?,?,?)",(user["id"],s["name"],s["status"],s["start"],s["end"],s.get("notes","") ))
                    self.json({"ok":True},201)
                except Exception as error:self.json({"error":str(error)},400)
        elif self.path.startswith("/api/admin/users/") and self.path.endswith("/password"):
            user=self.admin_required();match=re.fullmatch(r"/api/admin/users/(\d+)/password",self.path)
            if user and match:
                try:
                    password=self.read_json().get("password","")
                    if len(password)<8: raise ValueError("Le mot de passe doit contenir 8 caractères minimum.")
                    with db() as c:c.execute("UPDATE users SET password=? WHERE id=?",(hash_password(password),match[1]))
                    self.json({"ok":True})
                except Exception as error:self.json({"error":str(error)},400)
        else:self.send_error(404)
    def do_PUT(self):
        user=self.authenticated();match=re.fullmatch(r"/api/stages/(\d+)",self.path)
        if user and match:
            try:
                s=self.read_json()
                with db() as c:c.execute("UPDATE stages SET name=?,status=?,start=?,end=?,notes=? WHERE id=? AND user_id=?",(s["name"],s["status"],s["start"],s["end"],s.get("notes","") ,match[1],user["id"]))
                self.json({"ok":True})
            except Exception as error:self.json({"error":str(error)},400)
        elif user:self.send_error(404)
    def do_DELETE(self):
        user=self.authenticated();admin_match=re.fullmatch(r"/api/admin/users/(\d+)",self.path);match=re.fullmatch(r"/api/stages/(\d+)",self.path)
        if admin_match:
            if user and self.is_admin(user):
                if int(admin_match[1])==user["id"]:self.json({"error":"Tu ne peux pas supprimer ton propre compte administrateur."},400);return
                with db() as c:
                    c.execute("DELETE FROM sessions WHERE user_id=?",(admin_match[1],));c.execute("DELETE FROM stages WHERE user_id=?",(admin_match[1],));c.execute("DELETE FROM users WHERE id=?",(admin_match[1],))
                self.json({"ok":True})
            elif user:self.json({"error":"Accès administrateur requis."},403)
        if user and match:
            with db() as c:c.execute("DELETE FROM stages WHERE id=? AND user_id=?",(match[1],user["id"]))
            self.json({"ok":True})
        elif user:self.send_error(404)

if __name__=="__main__":
    os.chdir(ROOT);setup();print("Site disponible sur http://0.0.0.0:4177");ThreadingHTTPServer(("0.0.0.0",4177),Handler).serve_forever()
