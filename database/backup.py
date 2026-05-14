import shutil
import threading
from pathlib import Path
from datetime import datetime

BACKUP_DIR = Path(__file__).parent / 'backups'
MAX_BACKUPS = 15

def backup_db(db_path: str):
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = BACKUP_DIR / f'finance_{ts}.db'
    try:
        if Path(db_path).exists():
            shutil.copy2(db_path, backup_path)
            for old in sorted(BACKUP_DIR.glob('finance_*.db'), reverse=True)[MAX_BACKUPS:]:
                old.unlink(missing_ok=True)
    except Exception:
        pass

def backup_async(db_path: str):
    t = threading.Thread(target=backup_db, args=(db_path,), daemon=False)
    t.start()
