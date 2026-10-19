import unittest
from aikingbot_transport import AgentGateway,ReviewRequired
class Fake(AgentGateway):
 def __init__(self,request_type="permission"):
  self.denied=False;self.calls=[];self.request_type=request_type
 def messages(self,thread):
  rows=[{"role":"bot","kind":"text","text":"old greeting"},{"role":"user","kind":"text","sendId":"owned-send"}]
  if self.denied:rows.append({"role":"bot","kind":"text","text":"safe final"})
  else:rows.append({"role":"bot","kind":"options","card":{"requestId":"owned-request","requestType":self.request_type}})
  return rows
 def api(self,path,payload=None,**kwargs):
  self.calls.append((path,payload))
  if path.endswith("/respond"):
   assert payload["behavior"]=="deny";self.denied=True;return{"ok":True}
  return{"state":"completed" if self.denied else "needs-input"}
class Tests(unittest.TestCase):
 def test_customer_permission_is_denied_not_approved_and_final_correlates(self):
  f=Fake();self.assertEqual(f.wait_reply("owned-thread","owned-send",5),"safe final")
  replies=[p for path,p in f.calls if path.endswith("/respond")]
  self.assertEqual(len(replies),1);self.assertEqual(replies[0]["behavior"],"deny")
  self.assertNotIn("always",replies[0])
 def test_question_or_business_owner_input_is_not_automatically_answered(self):
  f=Fake("question")
  with self.assertRaises(ReviewRequired):f.wait_reply("owned-thread","owned-send",2)
  self.assertFalse(any(path.endswith("/respond") for path,_ in f.calls))
if __name__=="__main__":unittest.main()
