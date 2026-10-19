import {createHash} from "node:crypto";
import type {Pool} from "pg";
/** No provider idempotency API exists: an ambiguous side effect is held for review, never blindly sent twice. */
export class DeliveryGuard {
 constructor(private pool:Pool) {}
 async init():Promise<void> {
  await this.pool.query(`CREATE TABLE IF NOT EXISTS aiking_delivery_receipts (
   delivery_key TEXT PRIMARY KEY, state TEXT NOT NULL, receipt JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), error TEXT)`);
 }
 async once<T>(messageId:number|string,part:string,send:()=>Promise<T>):Promise<T> {
  const key=String(messageId)+":"+part;
  const inserted=await this.pool.query("INSERT INTO aiking_delivery_receipts(delivery_key,state) VALUES($1,'sending') ON CONFLICT DO NOTHING RETURNING delivery_key",[key]);
  if(!inserted.rowCount){
   const row=(await this.pool.query("SELECT state,receipt FROM aiking_delivery_receipts WHERE delivery_key=$1",[key])).rows[0];
   if(row?.state==="sent")return row.receipt as T;
   throw new Error("AIKING_OUTBOUND_UNCERTAIN: human reconciliation required; no duplicate provider send");
  }
  let result:T;
  try {result=await send();}
  catch(error){
   await this.pool.query("UPDATE aiking_delivery_receipts SET state='uncertain',error=$2 WHERE delivery_key=$1",[key,error instanceof Error?error.name:"provider_error"]);
   throw error;
  }
  // A DB failure here leaves 'sending', which prevents a retry from duplicating the external side effect.
  await this.pool.query("UPDATE aiking_delivery_receipts SET state='sent',receipt=$2::jsonb WHERE delivery_key=$1",[key,JSON.stringify(result)]);
  return result;
 }
}
export function attachmentPart(data:Buffer):string{return "file:"+createHash("sha256").update(data).digest("hex");}
