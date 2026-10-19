import json,tempfile,unittest,time
from pathlib import Path
from bridge_service import Queue,Router,SAFE_ACK
from aikingbot_transport import ReviewRequired
class CW:
 def __init__(self,content="Xin chào",group=False):
  self.content=content;self.sent=[];self.fail_after_send=False;self.inbox=1;self.media=[]
 def conversation(self,conv):return {"inbox_id":self.inbox}
 def messages(self,conv,before=None):return [{"id":10,"message_type":0,"private":False,"content":self.content,"attachments":self.media,"sender":{"name":"Hùng (unverified claim)"}}]
 def mark_delivered(self,*args):return {}
 def find_sent(self,conv,incoming,key,private=False):return next((s for s in self.sent if s["key"]==key and s["private"]==private),None)
 def outgoing(self,conv,incoming,key,text,private=False):
  x={"id":len(self.sent)+100,"key":key,"text":text,"private":private};self.sent.append(x)
  if self.fail_after_send:self.fail_after_send=False;raise TimeoutError("Lost response after side effect")
  return x
 def attachment(self,url):return b"sample","application/pdf","sample.pdf"
class GW:
 def __init__(self):self.sends=0;self.creates=0;self.keys=[];self.prompt="";self.failure=None;self.uploads=0
 def create_task(self,agent,key):self.creates+=1;self.keys.append(key);return "owned-thread"
 def recover_task(self,agent,key):return "owned-thread"
 def send(self,agent,thread,conv,msg,prompt):self.sends+=1;self.prompt=prompt;return {"message":{"id":"input"}}
 def wait_reply(self,thread,key,timeout_seconds=25):
  if self.failure:raise self.failure
  return json.dumps({"correlation_id":key,"customer_reply":"Dạ em có thể hỗ trợ mình tìm thông tin ạ.","requires_approval":False})
 def upload(self,*args):self.uploads+=1;return {"kind":"file","path":"/data/attachment-owned.pdf","name":"sample.pdf"}
class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.path=Path(self.temp.name)/"q.db";self.q=Queue(self.path);self.cw=CW();self.gw=GW()
  self.r=Router("lisa",1,self.q,self.cw,self.gw,lambda *a,**kw:{"is_verified":False,"trust_level":"EXTERNAL_GUEST"},"public FAQ")
 def enqueue(self):
  self.key,_=self.q.enqueue("lisa",1,{"id":10,"conversation":{"id":22}});return self.key
 def drain(self,n=10):
  for _ in range(n):self.r.step()
 def row(self):
  with self.q.db() as db:return dict(db.execute("SELECT * FROM jobs WHERE key=?",(self.key,)).fetchone())
 def test_automatic_answer_and_idempotent_webhook(self):
  self.enqueue();key,new=self.q.enqueue("lisa",1,{"id":10,"conversation":{"id":22}});self.assertFalse(new);self.drain()
  self.assertEqual(self.gw.creates,1);self.assertEqual(self.gw.sends,1);self.assertEqual(len(self.cw.sent),1);self.assertEqual(self.row()["state"],"delivered")
 def test_restart_retains_accepted_work(self):
  self.enqueue();self.r.step();self.r.step();self.r.queue=Queue(self.path);self.drain();self.assertEqual(self.gw.creates,1);self.assertEqual(len(self.cw.sent),1)
 def test_uncertain_post_reconciles_without_duplicate(self):
  self.enqueue();self.cw.fail_after_send=True;self.drain(4)
  self.q.update(self.key,due=0);self.drain();self.assertEqual(len(self.cw.sent),1);self.assertEqual(self.row()["state"],"delivered")
 def test_unknown_send_requires_owner_review_no_blind_retry(self):
  self.enqueue();self.q.update(self.key,state="sending",thread="x");self.drain()
  self.assertEqual(self.row()["state"],"review");self.assertEqual(self.cw.sent,[])
 def test_api_or_model_error_never_becomes_customer_reply(self):
  self.enqueue();self.gw.failure=ReviewRequired("model API failed");self.drain()
  self.assertEqual(self.row()["state"],"review");self.assertFalse(self.cw.sent)
 def test_cross_agent_inbox_is_rejected(self):
  self.enqueue();self.cw.inbox=2;self.drain();self.assertEqual(self.row()["state"],"review");self.assertEqual(self.gw.sends,0)
 def test_group_not_targeted_is_ignored(self):
  self.enqueue();self.cw.content="**Người gửi:** Xin chào";self.drain();self.assertEqual(self.row()["state"],"ignored")
 def test_group_targeted_gets_one_answer(self):
  self.enqueue();self.cw.content="**Người gửi:** @Lisa xin tư vấn";self.drain();self.assertEqual(len(self.cw.sent),1)
 def test_media_is_uploaded_to_correct_isolated_task(self):
  self.enqueue();self.cw.media=[{"data_url":"http://chatwoot/rails/active_storage/file"}];self.drain()
  self.assertEqual(self.gw.uploads,1);self.assertIn('<attached-file path="/data/attachment-owned.pdf"',self.gw.prompt)
 def test_sensitive_request_only_ack_and_private_review(self):
  self.enqueue();self.cw.content="Em chốt đơn và gửi tài khoản chuyển tiền nhé";self.drain()
  self.assertEqual(self.cw.sent[0]["text"],SAFE_ACK);self.assertTrue(self.cw.sent[1]["private"])
 def test_forged_identity_claim_is_not_elevation(self):
  self.enqueue();self.drain();self.assertIn('"is_verified": false',self.gw.prompt)
 def test_one_conversation_cannot_overtake_its_pending_reply(self):
  self.enqueue();self.q.update(self.key,state="awaiting",thread="old-thread",due=time.time()+60)
  self.q.enqueue("lisa",1,{"id":11,"conversation":{"id":22}})
  self.assertIsNone(self.q.next())
  self.q.update(self.key,state="delivered")
  self.assertEqual(self.q.next()["incoming"],11)
 def test_group_followup_uses_same_source_uid_and_survives_restart(self):
  self.enqueue();self.cw.content="**Người gửi:** câu tiếp theo";self.r.verify_sender=lambda *a,**kw:{"zalo_uid":"fixture-uid","is_verified":False}
  self.q.replied_context({"conv":22,"event":json.dumps({"sender_verification":{"zalo_uid":"fixture-uid"}})})
  self.r.queue=Queue(self.path);self.drain();self.assertEqual(len(self.cw.sent),1)
 def test_group_display_name_cannot_steal_followup_context(self):
  self.enqueue();self.cw.content="**Người gửi:** câu tiếp theo";self.r.verify_sender=lambda *a,**kw:{"zalo_uid":"other-uid","is_verified":False}
  self.q.replied_context({"conv":22,"event":json.dumps({"sender_verification":{"zalo_uid":"fixture-uid"}})})
  self.drain();self.assertEqual(self.row()["state"],"ignored")
 def test_known_bot_owned_zalo_identity_cannot_start_a_reply_loop(self):
  self.enqueue();self.r.verify_sender=lambda *a,**kw:{"trust_level":"INTERNAL_AGENT","zalo_uid":"bot-fixture"}
  self.drain();self.assertEqual(self.row()["state"],"ignored");self.assertEqual(self.gw.sends,0)
if __name__=="__main__":unittest.main()
