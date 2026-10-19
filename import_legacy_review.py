"""Preserve pre-existing unresolved deliveries without replaying old customer messages."""
from pathlib import Path
import json
from bridge_service import Queue
ROOT=Path(__file__).resolve().parent
rows=json.loads((ROOT/"evidence/legacy-reconciliation.json").read_text())
totals={"lisa":0,"aimie":0}
for row in rows:
 agent="lisa" if row["inbox"]==1 else "aimie"
 q=Queue(ROOT/"state"/agent/"queue.sqlite3")
 key,created=q.enqueue(agent,row["inbox"],{"id":int(row["message"]),"conversation":{"id":int(row["conversation"])},"legacy_status":row["status"],"legacy_created":row["created_at"]})
 if created:q.update(key,state="review",error="Pre-existing legacy "+row["status"]+"; reconcile before any resend. Created "+str(row["created_at"]))
 totals[agent]+=1
(ROOT/"evidence/legacy-review-import.json").write_text(json.dumps({"preserved":totals,"automatically_replayed":False},indent=2));print(json.dumps(totals))
